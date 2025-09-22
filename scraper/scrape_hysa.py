"""Scrape NerdWallet HYSA page using Firecrawl and fact-check with Gemini."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, asdict
from typing import List, Optional

from dotenv import load_dotenv
from firecrawl import Firecrawl
from firecrawl.v2.types import ExtractResponse
from bs4 import BeautifulSoup
import re
from google.generativeai import GenerativeModel, configure

TARGET_URL = "https://www.nerdwallet.com/best/banking/high-yield-online-savings-accounts"
DEFAULT_DATA_PATH = os.path.join(
    os.path.dirname(__file__),
    "..",
    "frontend",
    "public",
    "data",
    "hysa_accounts.json",
)

EXTRACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "accounts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "institution": {"type": "string"},
                    "apy": {"type": "string"},
                    "link": {"type": "string"},
                },
                "required": ["institution", "apy"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["accounts"],
    "additionalProperties": False,
}

EXTRACTION_PROMPT = (
    "Extract every bank or credit union highlighted in the roundup along with the "
    "advertised high-yield savings account APY. Include the exact APY string as "
    "published (keep percent symbols or qualifiers). Capture the best authoritative "
    "link for the institution's savings account page that lists that APY."
)

FACT_CHECK_PROMPT_TEMPLATE = (
    "You are validating APY data for a high-yield savings account.\n"
    "Bank: {institution}\n"
    "Claimed APY: {apy}\n"
    "Source URL: {link}\n\n"
    "Visit the source URL (follow redirects if needed) and confirm whether the page "
    "supports the claimed APY today. Respond with one of the following exactly:\n"
    "- VERIFIED (if the APY matches or is clearly supported)\n"
    "- REJECTED (if the APY differs or cannot be confirmed)\n"
    "- UNKNOWN (if the page is inaccessible or inconclusive)\n"
    "Provide a short justification after the label separated by a colon."
)


@dataclass
class AccountRecord:
    institution: str
    apy: str
    link: Optional[str]
    double_check: Optional[bool] = None
    fact_check_notes: Optional[str] = None

    def to_dict(self) -> dict:
        payload = asdict(self)
        # Keep consistent ordering for downstream consumers.
        return {
            "institution": payload["institution"],
            "apy": payload["apy"],
            "link": payload.get("link"),
            "double_check": payload.get("double_check"),
            "fact_check_notes": payload.get("fact_check_notes"),
        }


def ensure_output_directory(path: str) -> None:
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)


def load_credentials() -> tuple[str, Optional[str]]:
    """Load Firecrawl and Gemini credentials from the environment."""
    load_dotenv()
    firecrawl_key = os.getenv("FIRECRAWL_API_KEY")
    if not firecrawl_key:
        raise RuntimeError("FIRECRAWL_API_KEY is required to run the scraper.")
    gemini_key = os.getenv("GEMINI_API_KEY")
    return firecrawl_key, gemini_key


def scrape_accounts(client: Firecrawl) -> List[AccountRecord]:
    response: ExtractResponse = client.extract(
        urls=[TARGET_URL],
        schema=EXTRACTION_SCHEMA,
        prompt=EXTRACTION_PROMPT,
        show_sources=True,
    )

    if not response or not response.data:
        raise RuntimeError("Firecrawl extraction did not return any data.")

    accounts = response.data.get("accounts") if isinstance(response.data, dict) else None
    if not accounts:
        # Fallback: scrape raw content and heuristically parse APY + institution + link
        return scrape_accounts_fallback(client)

    records: List[AccountRecord] = []
    for item in accounts:
        institution = str(item.get("institution", "")).strip()
        apy = str(item.get("apy", "")).strip()
        link = item.get("link")
        link = str(link).strip() if link else None
        if not institution or not apy:
            continue
        records.append(AccountRecord(institution=institution, apy=apy, link=link))

    if not records:
        raise RuntimeError("No valid account records parsed from Firecrawl response.")
    return records


def scrape_accounts_fallback(client: Firecrawl) -> List[AccountRecord]:
    from firecrawl.v2.types import WaitAction, ScrollAction

    doc = client.scrape(
        TARGET_URL,
        formats=["html", "markdown"],
        only_main_content=False,
        wait_for=2000,
        block_ads=True,
        actions=[
            WaitAction(milliseconds=1500),
            ScrollAction(direction="down"),
            WaitAction(milliseconds=800),
        ],
    )
    html = doc.html or doc.raw_html or ""
    if not html:
        raise RuntimeError("Fallback scrape returned no HTML content.")

    soup = BeautifulSoup(html, "html.parser")

    def sanitize_text(text: str) -> str:
        # Remove markdown images/links and bullets if present
        t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", text)
        t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\\1", t)
        t = re.sub(r"^[-*]\s+", "", t).strip()
        # Collapse whitespace
        t = re.sub(r"\s+", " ", t)
        # Strip common noise terms
        return t

    noise_pat = re.compile(
        r"flag|instagram|youtube|x\([^)]*\)|apple\s+podcasts|united\s+states|united\s+kingdom",
        re.I,
    )

    def find_bank_name(container: "BeautifulSoup") -> Optional[str]:
        for tag in container.find_all(["h1", "h2", "h3", "h4", "strong"], limit=5):
            text = sanitize_text(tag.get_text(" ", strip=True))
            if not text:
                continue
            if noise_pat.search(text):
                continue
            # Heuristic: prefer names without excessive punctuation
            if len(text) >= 3 and len(text) <= 80:
                return text
        return None

    def find_bank_link(container: "BeautifulSoup") -> Optional[str]:
        links = container.find_all("a", href=True)
        best = None
        for a in links:
            href = a["href"].strip()
            if not href.startswith("http"):
                continue
            if "nerdwallet.com" in href:
                continue
            txt = (a.get_text(" ", strip=True) or "").lower()
            if "savings" in txt or "high" in txt or "apy" in txt or "rate" in txt:
                return href
            if "savings" in href or "high-yield" in href or "rate" in href:
                return href
            best = best or href
        return best

    # Allow APY to be present or omitted next to percentage
    apy_re = re.compile(r"\b(\d{1,2}(?:\.\d{1,3})?)%(?:\s*APY)?\b", re.IGNORECASE)
    seen = set()
    records: List[AccountRecord] = []

    # Search for APY strings and walk up to a reasonable container card
    for el in soup.find_all(string=apy_re):
        match = apy_re.search(str(el))
        if not match:
            continue
        apy_text = match.group(0)
        container = el
        # climb a few levels to get the card context
        for _ in range(6):
            if hasattr(container, "find") and container.name in ("article", "section", "div", "li"):
                break
            container = container.parent if getattr(container, "parent", None) else container

        # Require APY context to mention APY somewhere nearby to reduce noise
        context_txt = sanitize_text(container.get_text(" ", strip=True))[:400]
        if re.search(r"\bAPY\b", context_txt, re.I) is None:
            continue
        bank = find_bank_name(container) or ""
        link = find_bank_link(container)
        key = (bank, apy_text)
        if bank and not noise_pat.search(bank) and key not in seen:
            seen.add(key)
            records.append(AccountRecord(institution=bank, apy=apy_text, link=link))

    if not records:
        # Try parsing markdown as a secondary fallback
        md = doc.markdown or ""
        lines = [ln.strip() for ln in md.splitlines()]
        for i, ln in enumerate(lines):
            m = apy_re.search(ln)
            if not m:
                continue
            apy_text = m.group(0)
            # Look up a few lines for a plausible bank name (heading or bold)
            window = lines[max(0, i - 5):i]
            bank = next((
                sanitize_text(t.lstrip("# ").strip("* "))
                for t in reversed(window)
                if len(t.lstrip("#* ")) >= 3 and not noise_pat.search(t)
            ), "")
            if bank:
                key = (bank, apy_text)
                if key not in seen and not noise_pat.search(bank):
                    seen.add(key)
                    records.append(AccountRecord(institution=bank, apy=apy_text, link=None))

    if not records:
        raise RuntimeError("Fallback parser could not identify any APY entries.")

    return records


def resolve_outbound_links_with_playwright(records: List[AccountRecord]) -> None:
    """Replace NerdWallet review links with actual external bank APY pages using Playwright.

    - If a record.link is a NerdWallet URL, try to find an outbound link or click
      the primary CTA to follow redirects to the bank and capture the final URL.
    - This function is best-effort; failures leave the original link unchanged.
    """
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # noqa: BLE001 - optional dependency handling
        for r in records:
            if r.link and "nerdwallet.com" in r.link:
                r.fact_check_notes = (r.fact_check_notes or "") + " | Playwright not installed"
        return

    def is_external(url: str) -> bool:
        return url.startswith("http") and "nerdwallet.com" not in url

    def best_external_href(page) -> Optional[str]:
        # Prefer visible CTAs
        candidates = [
            "a:has-text('Open')",
            "a:has-text('Apply')",
            "a:has-text('Learn')",
            "a[aria-label*='Open']",
            "a[aria-label*='Apply']",
            "a[aria-label*='Learn']",
        ]
        for sel in candidates:
            loc = page.locator(sel)
            if loc.count() > 0:
                href = loc.first.get_attribute("href")
                if href and is_external(href):
                    return href
        # Any external link on page
        for a in page.query_selector_all("a[href]"):
            href = a.get_attribute("href") or ""
            if is_external(href):
                return href
        # NerdWallet redirect links often embed the real URL as a query param
        for a in page.query_selector_all("a[href*='redirect']"):
            href = a.get_attribute("href") or ""
            # naive extract of url= param if present
            if "url=" in href:
                try:
                    from urllib.parse import parse_qs, urlparse, unquote
                    qs = parse_qs(urlparse(href).query)
                    tgt = qs.get("url", [None])[0]
                    if tgt:
                        tgt = unquote(tgt)
                        if is_external(tgt):
                            return tgt
                except Exception:
                    pass
        return None

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        for r in records:
            if not r.link or "nerdwallet.com" not in r.link:
                continue
            try:
                page.goto(r.link, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_load_state("networkidle", timeout=30000)
                # Try best known hrefs first
                new_href = best_external_href(page)
                if not new_href:
                    # Try clicking primary CTA and capture resulting URL
                    cta = page.locator("a:has-text('Open'), a:has-text('Apply'), a:has-text('Learn')").first
                    if cta and cta.count() > 0:
                        with page.expect_navigation(timeout=30000):
                            cta.click()
                        if is_external(page.url):
                            new_href = page.url
                if new_href and is_external(new_href):
                    r.link = new_href
                else:
                    r.fact_check_notes = (r.fact_check_notes or "") + " | Could not resolve bank URL"
            except Exception as exc:  # pragma: no cover - network/browser flakiness
                r.fact_check_notes = (r.fact_check_notes or "") + f" | Playwright error: {exc}"
        context.close()
        browser.close()


def fact_check_accounts(records: List[AccountRecord], gemini_key: Optional[str]) -> None:
    if not gemini_key:
        for record in records:
            record.double_check = None
            record.fact_check_notes = (
                "Skipped: GEMINI_API_KEY not provided; unable to verify automatically."
            )
        return

    configure(api_key=gemini_key)
    model = GenerativeModel("gemini-1.5-flash")

    for record in records:
        prompt = FACT_CHECK_PROMPT_TEMPLATE.format(
            institution=record.institution,
            apy=record.apy,
            link=record.link or "(no link provided)",
        )
        try:
            response = model.generate_content(prompt)
            text = (response.text or "").strip()
        except Exception as exc:  # pragma: no cover - defensive logging path
            record.double_check = False
            record.fact_check_notes = f"Gemini error: {exc}"
            continue

        label, _, note = text.partition(":")
        label = label.strip().upper()
        note = note.strip() if note else ""

        if label == "VERIFIED":
            record.double_check = True
        elif label == "REJECTED":
            record.double_check = False
        else:
            record.double_check = None

        record.fact_check_notes = note or text


def save_records(records: List[AccountRecord], path: Optional[str] = None) -> None:
    output_path = path or os.getenv("OUTPUT_PATH") or DEFAULT_DATA_PATH
    ensure_output_directory(output_path)
    serialised = [record.to_dict() for record in records]
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump(serialised, handle, indent=2)


def run() -> None:
    firecrawl_key, gemini_key = load_credentials()
    client = Firecrawl(api_key=firecrawl_key)
    records = scrape_accounts(client)
    # Attempt to convert NerdWallet links to bank landing pages
    if os.getenv("RESOLVE_BANK_LINKS", "true").lower() in ("1", "true", "yes"):
        resolve_outbound_links_with_playwright(records)
    fact_check_accounts(records, gemini_key)
    save_records(records)
    print(
        f"Saved {len(records)} accounts to "
        f"{os.path.relpath(os.getenv('OUTPUT_PATH') or DEFAULT_DATA_PATH)}"
    )


if __name__ == "__main__":
    run()
