from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import Any, Dict, List

from bs4 import BeautifulSoup
from playwright.async_api import async_playwright

from scraping.http_session import make_session
from scraping.playwright_utils import ensure_pw_cache, playwright_context_kwargs

logger = logging.getLogger(__name__)

AGGREGATOR_URL = "https://www.nerdwallet.com/best/banking/high-yield-online-savings-accounts"
APY_PATTERN = re.compile(r"(?:APY\s*(?P<rate1>\d+\.\d+)%)|(?P<rate2>\d+\.\d+)\s*%", re.IGNORECASE)


def canonicalize(label: str) -> str:
    normalized = unicodedata.normalize("NFKD", label)
    cleaned = "".join(ch for ch in normalized if ch.isalnum() or ch.isspace())
    return re.sub(r"\s+", " ", cleaned).strip().lower()


BANK_OVERRIDES: Dict[str, Dict[str, str]] = {
    canonicalize("UFB Portfolio Savings"): {"bank": "UFB Direct", "product": "Portfolio Savings"},
    canonicalize("Openbank High Yield Savings"): {"bank": "Openbank", "product": "High Yield Savings"},
    canonicalize("Forbright Bank Growth Savings"): {"bank": "Forbright Bank", "product": "Growth Savings"},
    canonicalize("Discover Online Savings"): {"bank": "Discover Bank", "product": "Online Savings"},
    canonicalize("Synchrony Bank High Yield Savings"): {"bank": "Synchrony Bank", "product": "High Yield Savings"},
    canonicalize("Western Alliance Bank High-Yield Savings - Powered by Raisin"): {
        "bank": "Western Alliance Bank",
        "product": "High-Yield Savings (Raisin)",
    },
    canonicalize("Capital One 360 Performance Savings"): {"bank": "Capital One", "product": "360 Performance Savings"},
    canonicalize("LendingClub LevelUp Savings"): {"bank": "LendingClub", "product": "LevelUp Savings"},
    canonicalize("Barclays Tiered Savings Account"): {"bank": "Barclays", "product": "Tiered Savings"},
    canonicalize("Axos ONE Savings"): {"bank": "Axos Bank", "product": "ONE Savings"},
    canonicalize("American Express High Yield Savings Account"): {
        "bank": "American Express",
        "product": "High Yield Savings Account",
    },
    canonicalize("CIT Bank Platinum Savings"): {"bank": "CIT Bank", "product": "Platinum Savings"},
    canonicalize("Marcus by Goldman Sachs Online Savings Account"): {
        "bank": "Marcus by Goldman Sachs",
        "product": "Online Savings Account",
    },
    canonicalize("SoFi Checking and Savings"): {"bank": "SoFi", "product": "Checking and Savings"},
    canonicalize("E*TRADE Premium Savings"): {"bank": "E*TRADE", "product": "Premium Savings"},
}

FALLBACK_BANKS: List[Dict[str, Any]] = [
    {
        "bank": override["bank"],
        "product": override["product"],
        "apy": 4.0,
        "aggregator_url": AGGREGATOR_URL,
        "notes": "Fallback seed entry",
        "canonical": key,
    }
    for key, override in BANK_OVERRIDES.items()
]


@dataclass
class CompetitorRow:
    bank: str
    product: str
    apy: float
    aggregator_url: str
    canonical: str
    notes: str | None = None

    def as_dict(self) -> Dict[str, Any]:
        return {
            "bank": self.bank,
            "product": self.product,
            "apy": round(self.apy, 4),
            "aggregator_url": self.aggregator_url,
            "notes": self.notes or "",
            "canonical": self.canonical,
        }


async def _async_fetch_html(url: str) -> str:
    ensure_pw_cache()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(**playwright_context_kwargs())
        page = await context.new_page()
        await page.goto(url, wait_until="networkidle", timeout=45000)
        html = await page.content()
        await context.close()
        await browser.close()
        return html


def _fetch_with_playwright(url: str) -> str:
    return asyncio.run(_async_fetch_html(url))


def _fetch_with_requests(url: str) -> str:
    session = make_session()
    response = session.get(url)
    return response.text


def _load_html(url: str) -> str:
    try:
        return _fetch_with_playwright(url)
    except Exception as exc:
        logger.warning("Playwright fetch failed (%s); falling back to requests", exc)
        return _fetch_with_requests(url)


def _parse_cards(html: str) -> List[CompetitorRow]:
    soup = BeautifulSoup(html, "lxml")
    rows: List[CompetitorRow] = []
    seen: set[str] = set()

    for card in soup.select("[data-testid='product-card']"):
        title_el = card.select_one("a[class*='boxHeadline']")
        if not title_el:
            continue
        raw_name = title_el.get_text(strip=True)
        canonical_name = canonicalize(raw_name)
        override = BANK_OVERRIDES.get(canonical_name)
        bank_name = override["bank"] if override else raw_name
        product_name = override["product"] if override else raw_name
        if canonical_name in seen:
            continue

        text_blob = card.get_text(" ", strip=True)
        match = APY_PATTERN.search(text_blob)
        if not match:
            continue
        rate_str = match.group("rate1") or match.group("rate2")
        try:
            apy = float(rate_str)
        except (TypeError, ValueError):
            continue
        notes_el = card.find("p")
        notes = notes_el.get_text(strip=True) if notes_el else None

        rows.append(
            CompetitorRow(
                bank=bank_name,
                product=product_name,
                apy=apy,
                aggregator_url=AGGREGATOR_URL,
                canonical=canonical_name,
                notes=notes,
            )
        )
        seen.add(canonical_name)

    return rows


def fetch_competitors(limit: int | None = None) -> List[Dict[str, Any]]:
    try:
        html = _load_html(AGGREGATOR_URL)
        parsed = _parse_cards(html)
        if not parsed:
            raise ValueError("No competitors parsed from aggregator page")
        rows = parsed
    except Exception as exc:  # pragma: no cover - network fallbacks
        logger.error("Falling back to seed competitor list: %s", exc)
        rows = [CompetitorRow(**row) for row in FALLBACK_BANKS]
    if limit:
        rows = rows[:limit]
    return [row.as_dict() for row in rows]


__all__ = ["fetch_competitors", "canonicalize", "BANK_OVERRIDES"]
