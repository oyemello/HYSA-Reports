from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, List

import requests
from bs4 import BeautifulSoup
from tenacity import retry, stop_after_attempt, wait_fixed

logger = logging.getLogger(__name__)

try:
    from crawl4ai import AsyncCrawler, BrowserConfig
except ImportError:  # pragma: no cover - optional dependency at runtime
    AsyncCrawler = None  # type: ignore
    BrowserConfig = None  # type: ignore

AGGREGATOR_URL = "https://www.nerdwallet.com/article/banking/best-high-yield-online-savings-accounts"
USER_AGENT = "Mozilla/5.0 (compatible; HYSA-Pipeline/1.0; +https://github.com/<me>/<my-hysa-poc>)"

FALLBACK_BANKS = [
    {
        "bank": "American Express",
        "product": "High Yield Savings",
        "apy": 4.35,
        "aggregator_url": AGGREGATOR_URL,
        "notes": "Flat rate; no minimum balance; fallback seed",
    },
    {
        "bank": "Ally Bank",
        "product": "Online Savings Account",
        "apy": 4.35,
        "aggregator_url": AGGREGATOR_URL,
        "notes": "Highly rated HYSA; fallback seed",
    },
    {
        "bank": "Capital One",
        "product": "360 Performance Savings",
        "apy": 4.35,
        "aggregator_url": AGGREGATOR_URL,
        "notes": "National product; fallback seed",
    },
]


@dataclass
class CompetitorRow:
    bank: str
    product: str
    apy: float
    aggregator_url: str
    notes: str | None = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "bank": self.bank,
            "product": self.product,
            "apy": self.apy,
            "aggregator_url": self.aggregator_url,
            "notes": self.notes or "",
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


HYSA_APY_PATTERN = re.compile(r"(?P<rate>\d+\.\d+)\s*%\s*APY", re.IGNORECASE)


def _parse_table(html: str) -> List[CompetitorRow]:
    soup = BeautifulSoup(html, "lxml")
    rows: List[CompetitorRow] = []
    cards = soup.find_all("section")
    for card in cards:
        text = card.get_text(separator=" ", strip=True)
        match = HYSA_APY_PATTERN.search(text)
        if not match:
            continue
        title = card.find(["h2", "h3"])
        bank_name = title.get_text(strip=True) if title else ""
        if not bank_name:
            continue
        notes = None
        paragraph = card.find("p")
        if paragraph:
            notes = paragraph.get_text(strip=True)
        apy = float(match.group("rate"))
        product = "High Yield Savings"
        rows.append(
            CompetitorRow(
                bank=bank_name,
                product=product,
                apy=apy,
                aggregator_url=AGGREGATOR_URL,
                notes=notes,
            )
        )
    return rows


def fetch_competitors(limit: int | None = None) -> List[Dict[str, Any]]:
    try:
        html = _load_html(AGGREGATOR_URL)
        parsed = _parse_table(html)
        if not parsed:
            raise ValueError("No competitors parsed from aggregator page")
        rows = parsed
    except Exception as exc:  # pragma: no cover - offline fallback
        logger.error("Falling back to seed competitor list: %s", exc)
        rows = [CompetitorRow(**row) for row in FALLBACK_BANKS]
    if limit:
        rows = rows[:limit]
    return [row.as_dict() for row in rows]
