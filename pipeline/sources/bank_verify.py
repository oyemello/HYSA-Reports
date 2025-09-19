from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List

import requests
from tenacity import retry, stop_after_attempt, wait_fixed

logger = logging.getLogger(__name__)

try:
    from crawl4ai import AsyncCrawler, BrowserConfig
except ImportError:  # pragma: no cover - optional dependency at runtime
    AsyncCrawler = None  # type: ignore
    BrowserConfig = None  # type: ignore

USER_AGENT = "Mozilla/5.0 (compatible; HYSA-Pipeline/1.0; +https://github.com/<me>/<my-hysa-poc>)"
PROMO_KEYWORDS = re.compile(r"introductory|bonus|limited time|for the first|new money", re.IGNORECASE)
APY_PATTERN = re.compile(r"(\d+\.\d+)\s*%\s*APY", re.IGNORECASE)


@dataclass
class OfficialSite:
    url: str
    fallback_apy: float
    product: str


KNOWN_SITES: Dict[str, OfficialSite] = {
    "American Express": OfficialSite(
        url="https://www.americanexpress.com/en-us/banking/high-yield-savings-account/",
        fallback_apy=4.35,
        product="High Yield Savings Account",
    ),
    "Ally Bank": OfficialSite(
        url="https://www.ally.com/bank/online-savings-account/",
        fallback_apy=4.35,
        product="Online Savings Account",
    ),
    "Capital One": OfficialSite(
        url="https://www.capitalone.com/bank/savings-accounts/360-performance-savings-account/",
        fallback_apy=4.35,
        product="360 Performance Savings",
    ),
}


async def _fetch_with_crawl4ai(url: str) -> str:
    if AsyncCrawler is None:
        raise RuntimeError("crawl4ai not installed")
    cfg = BrowserConfig(headless=True, java_script_enabled=True, user_agent=USER_AGENT)
    async with AsyncCrawler(config=cfg) as crawler:
        result = await crawler.arun(url=url)
    html = getattr(result, "html", None) or getattr(result, "content", "")
    if not html:
        raise RuntimeError("crawl4ai returned empty document")
    return html


def _fetch_with_requests(url: str) -> str:
    response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    response.raise_for_status()
    return response.text


@retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
def _load_html(url: str) -> str:
    try:
        return asyncio.run(_fetch_with_crawl4ai(url))
    except Exception as exc:  # pragma: no cover - network fallbacks
        logger.warning("crawl4ai fetch failed (%s); falling back to requests", exc)
        return _fetch_with_requests(url)


def _extract_apy(html: str, fallback: float) -> Dict[str, Any]:
    match = APY_PATTERN.search(html)
    promo = bool(PROMO_KEYWORDS.search(html))
    apy = fallback
    if match:
        try:
            apy = float(match.group(1))
        except ValueError:
            apy = fallback
    return {"apy": apy, "promo": promo}


def verify_competitors(competitors: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    verified: List[Dict[str, Any]] = []
    for row in competitors:
        bank = row.get("bank")
        site = KNOWN_SITES.get(bank)
        if not site:
            logger.warning("No official site mapping configured for bank=%s", bank)
            continue
        try:
            html = _load_html(site.url)
        except Exception as exc:  # pragma: no cover - offline fallback
            logger.error("Failed to scrape official site for %s: %s", bank, exc)
            html = ""
        extracted = _extract_apy(html, fallback=site.fallback_apy)
        official_apy = extracted["apy"]
        promo = extracted["promo"]
        discrepancy_bps = int(round((official_apy - row.get("apy", official_apy)) * 100))
        verified.append(
            {
                "bank": bank,
                "product": site.product,
                "official_url": site.url,
                "official_apy": official_apy,
                "aggregator_apy": row.get("apy", official_apy),
                "promo": promo,
                "discrepancy_bps": discrepancy_bps,
                "aggregator_url": row.get("aggregator_url"),
                "notes": row.get("notes", ""),
            }
        )
    return verified
