"""Scrape NerdWallet HYSA page using Firecrawl and fact-check with Gemini."""
from __future__ import annotations

import base64
import difflib
import html
import json
import os
from dataclasses import dataclass, asdict
from typing import List, Optional, Set

from dotenv import load_dotenv
from firecrawl import Firecrawl
from firecrawl.v2.types import ExtractResponse
from bs4 import BeautifulSoup
import re
from urllib.parse import parse_qs, urlparse, unquote
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
    "The URL should be the financial institution's official page (or a landing page) "
    "where the advertised APY is clearly stated.\n"
    "Visit the source URL (follow redirects if needed) and confirm whether the page "
    "supports the claimed APY today. Respond with one of the following exactly:\n"
    "- VERIFIED (if the APY matches or is clearly supported)\n"
    "- REJECTED (if the APY differs or cannot be confirmed)\n"
    "- UNKNOWN (if the page is inaccessible or inconclusive)\n"
    "Provide a short justification after the label separated by a colon."
)
MARKDOWN_IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
BULLET_PREFIX_RE = re.compile(r"^[\-\*\u2022\u00b7]+\s*")
DATA_URI_RE = re.compile(r"data:image[^)]+\)", re.IGNORECASE)
WHITESPACE_RE = re.compile(r"\s+")
MIN_ALPHA_RE = re.compile(r"[a-zA-Z]{3}")
NOISE_REGEX = re.compile(
    r"flag|instagram|youtube|facebook|twitter|x.com|apple\s+podcasts|united\s+states|"
    r"united\s+kingdom|usa only|rss feed|privacy|cookie",
    re.IGNORECASE,
)
EXACT_NOISE = {
    "usa",
    "united states",
    "united states flag",
    "united kingdom",
    "united kingdom flag",
    "instagram",
    "apple podcasts",
    "facebook",
    "twitter",
    "youtube",
}


def clean_text(raw: Optional[str]) -> str:
    if not raw:
        return ""
    text = html.unescape(raw)
    text = MARKDOWN_IMAGE_RE.sub("", text)
    text = DATA_URI_RE.sub("", text)
    text = MARKDOWN_LINK_RE.sub(r"\1", text)
    text = BULLET_PREFIX_RE.sub("", text)
    text = text.replace("•", " ").replace("·", " ")
    text = WHITESPACE_RE.sub(" ", text)
    return text.strip(" -")


def normalise_institution(raw: Optional[str]) -> str:
    text = clean_text(raw)
    if not text:
        return ""
    lower = text.lower()
    if lower in EXACT_NOISE:
        return ""
    if NOISE_REGEX.search(lower):
        return ""
    if not MIN_ALPHA_RE.search(text):
        return ""
    if len(text) > 120:
        return ""
    return text


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
        institution = normalise_institution(item.get("institution"))
        apy = clean_text(item.get("apy"))
        link_raw = item.get("link")
        link = str(link_raw).strip() if link_raw else None
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

    def find_bank_name(container: "BeautifulSoup") -> Optional[str]:
        for tag in container.find_all(["h1", "h2", "h3", "h4", "strong"], limit=5):
            text = normalise_institution(tag.get_text(" ", strip=True))
            if text:
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
    seen: Set[tuple[str, str]] = set()
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
        context_txt = clean_text(container.get_text(" ", strip=True))[:400]
        if re.search(r"\bAPY\b", context_txt, re.I) is None:
            continue
        bank = find_bank_name(container) or ""
        link = find_bank_link(container)
        key = (bank, apy_text)
        if bank and key not in seen:
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
            bank = ""
            for t in reversed(window):
                candidate = normalise_institution(t.lstrip("# ").strip("* "))
                if candidate:
                    bank = candidate
                    break
            if bank:
                key = (bank, apy_text)
                if key not in seen:
                    seen.add(key)
                    records.append(AccountRecord(institution=bank, apy=apy_text, link=None))

    if not records:
        raise RuntimeError("Fallback parser could not identify any APY entries.")

    return records


def resolve_outbound_links_with_playwright(records: List[AccountRecord]) -> None:
    """Replace NerdWallet review links with actual external bank APY pages using Playwright.

    - Accepts cookie banners to prevent OneTrust links from being captured.
    - Prefers CTA buttons, parses NerdWallet redirect URLs, and validates hostnames.
    - This function is best-effort; failures leave the original link unchanged.
    """
    try:
        from playwright.sync_api import TimeoutError as PlaywrightTimeoutError, sync_playwright
    except Exception:  # noqa: BLE001 - optional dependency handling
        for r in records:
            if r.link and "nerdwallet.com" in r.link:
                note = (r.fact_check_notes or "") + " | Playwright not installed"
                r.fact_check_notes = note.strip(" |")
        return

    CTA_SELECTORS = [
        "a[data-testid*='cta']",
        "a:has-text('Open account')",
        "a:has-text('Open Account')",
        "a:has-text('Open now')",
        "a:has-text('Open Now')",
        "a:has-text('Apply')",
        "a:has-text('Learn more')",
        "a:has-text('See offer')",
        "a[aria-label*='Open']",
        "a[aria-label*='Apply']",
        "a[aria-label*='Learn']",
    ]
    FALLBACK_SELECTORS = [
        "a[href*='redirect']",
        "a[href*='outbound']",
        "a[href*='go.nerdwallet.com']",
        "a[href*='affiliate']",
    ]
    CONSENT_SELECTORS = [
        "#onetrust-accept-btn-handler",
        ".onetrust-accept-btn-handler",
        "button:has-text('Accept All')",
        "button:has-text('Accept all')",
        "button:has-text('Accept Cookies')",
    ]
    REDIRECT_PARAMETERS = [
        "url",
        "dest",
        "destination",
        "destination_url",
        "redirect",
        "redirectUrl",
        "redirect_url",
        "redirectTo",
        "r",
        "to",
        "target",
    ]
    HOST_DENYLIST = {
        "onetrust.com",
        "privacyportal.de",
        "facebook.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "youtube.com",
        "itunes.apple.com",
        "play.google.com",
        "doubleclick.net",
        "googletagmanager.com",
        "googleadservices.com",
        "linksynergy.com",
    }

    def canonicalize(text: str) -> str:
        return re.sub(r"[^a-z0-9]", "", text.lower())

    def host_from_url(url: str) -> str:
        parsed = urlparse(url)
        host = parsed.netloc.lower()
        if host.startswith("www."):
            host = host[4:]
        return host

    def is_valid_external(url: str) -> bool:
        if not url or not url.startswith("http"):
            return False
        host = host_from_url(url)
        if "nerdwallet.com" in host:
            return False
        return not any(host == blocked or host.endswith(f".{blocked}") for blocked in HOST_DENYLIST)

    def decode_maybe_base64(value: str) -> Optional[str]:
        cleaned = value.strip()
        if not cleaned:
            return None
        for padding in ("", "=", "==", "==="):
            try:
                decoded = base64.urlsafe_b64decode(cleaned + padding).decode("utf-8", "ignore")
            except Exception:
                continue
            if decoded.startswith("http"):
                return decoded
        return None

    def extract_redirect_target(href: str) -> Optional[str]:
        if not href:
            return None
        parsed = urlparse(href)
        qs = parse_qs(parsed.query)
        for key in REDIRECT_PARAMETERS:
            if key not in qs:
                continue
            for candidate in qs[key]:
                if not candidate:
                    continue
                candidate = unquote(candidate)
                if candidate.startswith("//"):
                    candidate = "https:" + candidate
                if candidate.startswith("http") and is_valid_external(candidate):
                    return candidate
                decoded = decode_maybe_base64(candidate)
                if decoded and is_valid_external(decoded):
                    return decoded
        if parsed.fragment:
            frag = unquote(parsed.fragment)
            if frag.startswith("http") and is_valid_external(frag):
                return frag
        return None

    def host_matches_institution(url: str, institution: str) -> bool:
        if not url or not institution:
            return False
        host = host_from_url(url)
        host_parts = [canonicalize(part) for part in host.split(".") if part and part not in {"www", "com", "net", "org"}]
        inst_tokens = [canonicalize(tok) for tok in re.split(r"[^a-z0-9]+", institution) if len(tok) >= 3]
        if not host_parts or not inst_tokens:
            return False
        host_join = "".join(host_parts)
        inst_join = "".join(inst_tokens)
        for token in inst_tokens:
            if token and token in host_join:
                return True
        for part in host_parts:
            if part and any(part in token or token in part for token in inst_tokens):
                return True
        ratio = difflib.SequenceMatcher(None, host_join, inst_join).ratio()
        return ratio >= 0.45

    def choose_candidate(urls: List[str], institution: str) -> Optional[str]:
        preferred = None
        fallback = None
        for url in urls:
            if not is_valid_external(url):
                continue
            if host_matches_institution(url, institution):
                preferred = url
                break
            fallback = fallback or url
        return preferred or fallback

    def append_note(record: AccountRecord, message: str) -> None:
        if not message:
            return
        record.fact_check_notes = (record.fact_check_notes + " | " + message).strip(" |") if record.fact_check_notes else message

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            locale="en-US",
            timezone_id="America/New_York",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
            ),
        )
        # Pre-seed consent cookie to reduce banners
        context.add_cookies([
            {
                "name": "OptanonConsent",
                "value": "isIABGlobal=false&datestamp=2020-01-01T00:00:00&version=6.16.0",
                "domain": ".nerdwallet.com",
                "path": "/",
                "httpOnly": False,
                "secure": True,
            }
        ])
        page = context.new_page()

        for record in records:
            if not record.link or "nerdwallet.com" not in record.link:
                continue

            direct_candidate = extract_redirect_target(record.link)
            if direct_candidate and is_valid_external(direct_candidate):
                if host_matches_institution(direct_candidate, record.institution):
                    record.link = direct_candidate
                    continue

            try:
                page.goto(record.link, wait_until="domcontentloaded", timeout=30000)
            except PlaywrightTimeoutError as exc:
                append_note(record, f"Playwright timeout opening page: {exc}")
                continue

            # Attempt to accept consent banners
            for selector in CONSENT_SELECTORS:
                try:
                    consent_button = page.locator(selector)
                    if consent_button.count() > 0 and consent_button.first.is_visible():
                        consent_button.first.click(timeout=2000)
                        page.wait_for_timeout(500)
                        break
                except PlaywrightTimeoutError:
                    continue
                except Exception:
                    continue

            try:
                page.wait_for_load_state("networkidle", timeout=15000)
            except PlaywrightTimeoutError:
                pass

            page.mouse.wheel(0, 1500)
            page.wait_for_timeout(500)

            candidate_urls: List[str] = []

            def extract_url_from_locator(locator) -> Optional[str]:
                try:
                    href = (locator.get_attribute("href") or "").strip()
                except Exception:
                    href = ""
                candidate = extract_redirect_target(href) or href
                if candidate and is_valid_external(candidate):
                    return candidate
                return None

            def click_and_capture(locator) -> Optional[str]:
                try:
                    with page.expect_popup(timeout=5000) as popup_info:
                        locator.click()
                    new_page = popup_info.value
                    new_page.wait_for_load_state("networkidle", timeout=15000)
                    url = new_page.url
                    new_page.close()
                    return url
                except PlaywrightTimeoutError:
                    try:
                        with page.expect_navigation(timeout=5000):
                            locator.click()
                        page.wait_for_load_state("networkidle", timeout=15000)
                        return page.url
                    except PlaywrightTimeoutError:
                        return None
                except Exception:
                    return None

            for selector in CTA_SELECTORS + FALLBACK_SELECTORS:
                locator = page.locator(selector)
                if locator.count() == 0:
                    continue
                candidate = extract_url_from_locator(locator.first)
                if candidate:
                    candidate_urls.append(candidate)
                    break
                click_target = click_and_capture(locator.first)
                if click_target and is_valid_external(click_target):
                    candidate_urls.append(click_target)
                    break

            if not candidate_urls:
                for anchor in page.query_selector_all("a[href]"):
                    href = anchor.get_attribute("href") or ""
                    candidate = extract_redirect_target(href) or href
                    if candidate and is_valid_external(candidate):
                        candidate_urls.append(candidate)
                        if host_matches_institution(candidate, record.institution):
                            break

            best = choose_candidate(candidate_urls, record.institution)
            if best:
                record.link = best
            else:
                append_note(record, "Could not resolve bank URL")

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
        existing_note = record.fact_check_notes
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
            message = f"Gemini error: {exc}"
            record.fact_check_notes = (
                (existing_note + " | " + message).strip(" |")
                if existing_note
                else message
            )
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

        message = note or text
        if message:
            record.fact_check_notes = (
                (existing_note + " | " + message).strip(" |")
                if existing_note
                else message
            )
        else:
            record.fact_check_notes = existing_note


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
