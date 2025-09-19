from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List

import requests
from tenacity import retry, stop_after_attempt, wait_fixed

from pipeline.sources.nerdwallet import BANK_OVERRIDES, canonicalize

logger = logging.getLogger(__name__)

try:
    from crawl4ai import AsyncWebCrawler, BrowserConfig
except ImportError:  # pragma: no cover - optional dependency at runtime
    AsyncWebCrawler = None  # type: ignore[attr-defined]
    BrowserConfig = None  # type: ignore[attr-defined]

USER_AGENT = "Mozilla/5.0 (compatible; HYSA-Pipeline/1.0; +https://github.com/<me>/<my-hysa-poc>)"
PROMO_KEYWORDS = re.compile(r"introductory|bonus|limited time|for the first|new money|teaser", re.IGNORECASE)
APY_PATTERN = re.compile(r"(\d+\.\d+)\s*%", re.IGNORECASE)


@dataclass
class OfficialSite:
    url: str
    fallback_apy: float
    product: str


def _site(url: str, fallback: float, product: str) -> OfficialSite:
    return OfficialSite(url=url, fallback_apy=fallback, product=product)


KNOWN_SITES: Dict[str, OfficialSite] = {
    canonicalize("American Express High Yield Savings Account"): _site(
        "https://www.americanexpress.com/en-us/banking/high-yield-savings-account/",
        4.35,
        "High Yield Savings Account",
    ),
    canonicalize("Capital One 360 Performance Savings"): _site(
        "https://www.capitalone.com/bank/savings-accounts/360-performance-savings-account/",
        4.35,
        "360 Performance Savings",
    ),
    canonicalize("Synchrony Bank High Yield Savings"): _site(
        "https://www.synchronybank.com/banking/savings/high-yield-savings/",
        4.30,
        "High Yield Savings",
    ),
    canonicalize("Discover Online Savings"): _site(
        "https://www.discover.com/online-banking/savings-account/",
        4.30,
        "Online Savings",
    ),
    canonicalize("CIT Bank Platinum Savings"): _site(
        "https://www.cit.com/cit-bank/savings-builder",
        4.00,
        "Platinum Savings",
    ),
    canonicalize("Marcus by Goldman Sachs Online Savings Account"): _site(
        "https://www.marcus.com/us/en/savings/online-savings-account",
        4.40,
        "Online Savings Account",
    ),
    canonicalize("SoFi Checking and Savings"): _site(
        "https://www.sofi.com/banking/checking-and-savings/",
        4.60,
        "Checking and Savings",
    ),
    canonicalize("E*TRADE Premium Savings"): _site(
        "https://us.etrade.com/bank/savings",
        4.00,
        "Premium Savings",
    ),
    canonicalize("Barclays Tiered Savings Account"): _site(
        "https://www.banking.barclaysus.com/online-savings.html",
        4.35,
        "Tiered Savings",
    ),
    canonicalize("Axos ONE Savings"): _site(
        "https://www.axosbank.com/personal/savings/axos-one-savings",
        4.46,
        "ONE Savings",
    ),
    canonicalize("UFB Portfolio Savings"): _site(
        "https://www.ufbdirect.com/banking/savings/ufb-savings",
        3.90,
        "Portfolio Savings",
    ),
    canonicalize("Openbank High Yield Savings"): _site(
        "https://www.myopenbanking.com/high-yield-savings",
        4.20,
        "High Yield Savings",
    ),
    canonicalize("Forbright Bank Growth Savings"): _site(
        "https://www.forbrightbank.com/personal-banking/high-yield-savings",
        4.25,
        "Growth Savings",
    ),
    canonicalize("Western Alliance Bank High-Yield Savings - Powered by Raisin"): _site(
        "https://www.raisin.com/savings/western-alliance-bank-high-yield-savings/",
        4.25,
        "High-Yield Savings (Raisin)",
    ),
    canonicalize("LendingClub LevelUp Savings"): _site(
        "https://www.lendingclub.com/personal-banking/savings/levelup",
        4.20,
        "LevelUp Savings",
    ),
}


async def _fetch_with_crawl4ai(url: str) -> str:
    if AsyncWebCrawler is None:
        raise RuntimeError("crawl4ai is not available")
    cfg = BrowserConfig(headless=True, java_script_enabled=True, user_agent=USER_AGENT)
    async with AsyncWebCrawler(config=cfg) as crawler:
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
        canonical_name = row.get("canonical") or canonicalize(row.get("product") or row.get("bank", ""))
        site = KNOWN_SITES.get(canonical_name)
        if not site:
            logger.warning("No official site mapping configured for product=%s", row.get("product"))
            existing_notes = row.get("notes") or ""
            pending_note = f"{existing_notes} | verification pending" if existing_notes else "verification pending"
            verified.append(
                {
                    "bank": row.get("bank", ""),
                    "product": row.get("product", ""),
                    "official_url": row.get("aggregator_url", ""),
                    "official_apy": row.get("apy"),
                    "aggregator_apy": row.get("apy"),
                    "promo": False,
                    "discrepancy_bps": 0,
                    "aggregator_url": row.get("aggregator_url"),
                    "notes": pending_note,
                    "verification": "aggregator_only",
                }
            )
            continue
        try:
            html = _load_html(site.url)
        except Exception as exc:  # pragma: no cover - offline fallback
            logger.error("Failed to scrape official site for %s: %s", row.get("bank"), exc)
            html = ""
        extracted = _extract_apy(html, fallback=site.fallback_apy)
        official_apy = extracted["apy"]
        promo = extracted["promo"]
        discrepancy_bps = int(round((official_apy - row.get("apy", official_apy)) * 100))
        verified.append(
            {
                "bank": row.get("bank", ""),
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


__all__ = ["verify_competitors"]
