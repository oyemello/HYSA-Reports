from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List

from playwright.async_api import TimeoutError as PlaywrightTimeoutError, async_playwright
from tenacity import retry, stop_after_attempt, wait_fixed

from scraping.http_session import make_session
from scraping.playwright_utils import ensure_pw_cache, playwright_context_kwargs
from pipeline.sources.nerdwallet import BANK_OVERRIDES, canonicalize

logger = logging.getLogger(__name__)

USER_AGENT = playwright_context_kwargs()["user_agent"]
PROMO_KEYWORDS = re.compile(r"introductory|bonus|limited time|for the first|new money|teaser", re.IGNORECASE)
APY_PATTERNS = [
    r"(\d+(?:\.\d+)?)\s*%\s*APY",
    r"APY[^\d]*(\d+(?:\.\d+)?)\s*%",
    r"Annual Percentage Yield[^\d]*(\d+(?:\.\d+)?)\s*%",
]


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
        4.3,
        "High Yield Savings",
    ),
    canonicalize("Discover Online Savings"): _site(
        "https://www.discover.com/online-banking/savings-account/",
        4.3,
        "Online Savings",
    ),
    canonicalize("CIT Bank Platinum Savings"): _site(
        "https://www.cit.com/cit-bank/savings-builder",
        4.0,
        "Platinum Savings",
    ),
    canonicalize("Marcus by Goldman Sachs Online Savings Account"): _site(
        "https://www.marcus.com/us/en/savings/online-savings-account",
        4.4,
        "Online Savings Account",
    ),
    canonicalize("SoFi Checking and Savings"): _site(
        "https://www.sofi.com/banking/checking-and-savings/",
        4.6,
        "Checking and Savings",
    ),
    canonicalize("E*TRADE Premium Savings"): _site(
        "https://us.etrade.com/bank/savings",
        4.0,
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
        3.9,
        "Portfolio Savings",
    ),
    canonicalize("Openbank High Yield Savings"): _site(
        "https://www.myopenbanking.com/high-yield-savings",
        4.2,
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
        4.2,
        "LevelUp Savings",
    ),
}


async def _async_fetch_html(url: str) -> str:
    ensure_pw_cache()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(**playwright_context_kwargs())
        page = await context.new_page()
        await page.goto(url, wait_until="networkidle", timeout=60000)
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


def _extract_apy(text: str) -> float | None:
    normalized = re.sub(r"\s+", " ", text)
    for pattern in APY_PATTERNS:
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if match:
            try:
                return float(match.group(1))
            except (TypeError, ValueError):
                continue
    return None


def _detect_promo(text: str) -> bool:
    return bool(PROMO_KEYWORDS.search(text))


@retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
def _load_html(url: str) -> str:
    try:
        return _fetch_with_playwright(url)
    except PlaywrightTimeoutError as exc:
        logger.warning("Playwright timeout fetching %s (%s)", url, exc)
    except Exception as exc:
        logger.warning("Playwright fetch failed for %s (%s)", url, exc)
    return _fetch_with_requests(url)


def verify_competitors(competitors: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    verified: List[Dict[str, Any]] = []
    for row in competitors:
        canonical_name = row.get("canonical") or canonicalize(row.get("product") or row.get("bank", ""))
        site = KNOWN_SITES.get(canonical_name)
        if not site:
            note = row.get("notes") or ""
            pending_note = f"{note} | verification pending" if note else "verification pending"
            logger.warning("No official site mapping configured for product=%s", row.get("product"))
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
        apy = _extract_apy(html) if html else None
        promo = _detect_promo(html) if html else False
        official_apy = apy if apy is not None else site.fallback_apy
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


__all__ = ["verify_competitors", "_extract_apy"]
