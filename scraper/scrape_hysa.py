"""Scrape NerdWallet HYSA page using Firecrawl and fact-check with Gemini."""
from __future__ import annotations

import base64
import difflib
import html
import json
import os
from dataclasses import dataclass, asdict
from typing import List, Optional, Set, Tuple

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
    nerdwallet_link: Optional[str]
    bank_link: Optional[str] = None
    double_check: Optional[bool] = None
    fact_check_notes: Optional[str] = None

    def to_dict(self) -> dict:
        payload = asdict(self)
        # Keep consistent ordering for downstream consumers.
        return {
            "institution": payload["institution"],
            "apy": payload["apy"],
            "nerdwallet_link": payload.get("nerdwallet_link"),
            "bank_link": payload.get("bank_link"),
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
        nerdwallet_link = str(link_raw).strip() if link_raw else None
        if not institution or not apy:
            continue
        records.append(
            AccountRecord(
                institution=institution,
                apy=apy,
                nerdwallet_link=nerdwallet_link,
            )
        )

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
            records.append(
                AccountRecord(
                    institution=bank,
                    apy=apy_text,
                    nerdwallet_link=link,
                )
            )

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
                    records.append(
                        AccountRecord(
                            institution=bank,
                            apy=apy_text,
                            nerdwallet_link=None,
                        )
                    )

    if not records:
        raise RuntimeError("Fallback parser could not identify any APY entries.")

    return records


def canonicalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


BLOCKED_HOSTS = {
    "nerdwallet.com",
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


BRAND_DOMAIN_HINTS = {
    # Core brands from NerdWallet HYSA roundup
    "axos": "axosbank.com",
    "openbank": "openbank.es",  # Openbank by Santander (EU)
    "santander": "santanderbank.com",
    "forbright": "forbrightbank.com",
    "western alliance": "westernalliancebank.com",
    "etrade": "etrade.com",
    "synchrony": "synchronybank.com",
    "discover": "discover.com",
    "marcus by goldman sachs": "marcus.com",
    "marcus": "marcus.com",
    "sofi": "sofi.com",
    "capital one": "capitalone.com",
    "barclays": "barclaysus.com",
    "ufb direct": "ufbdirect.com",
}


def host_from_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        host = (parsed.netloc or "").lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def is_external_bank(url: Optional[str]) -> bool:
    if not url or not url.startswith("http"):
        return False
    host = host_from_url(url)
    if not host:
        return False
    if any(host == b or host.endswith("." + b) for b in BLOCKED_HOSTS):
        return False
    return True


def host_matches_institution(url: str, institution: str) -> bool:
    host = host_from_url(url)
    if not host or not institution:
        return False
    host_core = canonicalize("".join([p for p in host.split(".") if p not in {"www", "com", "net", "org", "us"}]))
    inst_core = canonicalize(institution)
    if not host_core or not inst_core:
        return False
    return inst_core[:5] in host_core or host_core[:5] in inst_core


def decode_maybe_base64(value: str) -> Optional[str]:
    cleaned = (value or "").strip()
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
    try:
        parsed = urlparse(href)
    except Exception:
        return None
    qs = parse_qs(parsed.query)
    for key in REDIRECT_PARAMETERS:
        if key not in qs:
            continue
        for candidate in qs[key]:
            cand = unquote(candidate or "")
            if cand.startswith("//"):
                cand = "https:" + cand
            if cand.startswith("http") and is_external_bank(cand):
                return cand
            decoded = decode_maybe_base64(cand)
            if decoded and is_external_bank(decoded):
                return decoded
    if parsed.fragment:
        frag = unquote(parsed.fragment)
        if frag.startswith("http") and is_external_bank(frag):
            return frag
    return None


def score_url(url: str, institution: str) -> Tuple[int, int]:
    host = host_from_url(url)
    score_match = 1 if host_matches_institution(url, institution) else 0
    score_keywords = 0
    path = urlparse(url).path.lower()
    for kw in ("savings", "high", "yield", "apy", "rate"):
        if kw in path:
            score_keywords += 1
    return score_match, score_keywords


def resolve_bank_link_from_review(review_url: Optional[str], institution: str, client: Firecrawl) -> Optional[str]:
    if not review_url or "nerdwallet.com" not in review_url:
        return None
    # Try direct redirect decoding first
    direct = extract_redirect_target(review_url)
    if direct and is_external_bank(direct):
        return direct
    # Scrape anchors quickly
    try:
        doc = client.scrape(review_url, formats=["html", "markdown"], only_main_content=True, timeout=20_000)
        html_body = doc.html or doc.raw_html or ""
    except Exception:
        html_body = ""
    candidates: List[str] = []
    if html_body:
        soup = BeautifulSoup(html_body, "html.parser")
        affiliate_first: List[str] = []
        others: List[str] = []
        for a in soup.find_all("a", href=True):
            href = a.get("href", "").strip()
            if not href:
                continue
            cand = extract_redirect_target(href) or href
            if not is_external_bank(cand):
                continue
            href_l = href.lower()
            if "go.nerdwallet.com" in href_l or "redirect" in href_l or "outbound" in href_l:
                affiliate_first.append(cand)
            else:
                others.append(cand)
        candidates = affiliate_first + others
    if candidates:
        ranked = sorted(candidates, key=lambda u: score_url(u, institution), reverse=True)
        return ranked[0]
    return None


def resolve_bank_link_by_search(institution: str, client: Firecrawl) -> Optional[str]:
    key = canonicalize(institution)
    hint_domain = None
    for name, domain in BRAND_DOMAIN_HINTS.items():
        if name.replace(" ", "") in key:
            hint_domain = domain
            break

    queries: List[str] = []
    if hint_domain:
        queries.append(f"site:{hint_domain} {institution} savings APY")
        queries.append(f"site:{hint_domain} high-yield savings APY")
    queries.append(f"{institution} high-yield savings APY")
    queries.append(f"{institution} savings rates APY")

    best: Optional[str] = None
    best_score = (-1, -1)
    for q in queries:
        try:
            res = client.search(q, limit=5)
            web = res.web or []
        except Exception:
            web = []
        for r in web:
            url = getattr(r, "url", None)
            if not is_external_bank(url):
                continue
            s = score_url(url, institution)
            if s > best_score:
                best = url
                best_score = s
        if best:
            break

    if best:
        return best
    if hint_domain:
        return f"https://{hint_domain}/"
    return None


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
        # Prefer the resolved bank link for verification; fall back to nerdwallet link
        chosen_link = record.bank_link or record.nerdwallet_link or "(no link provided)"
        prompt = FACT_CHECK_PROMPT_TEMPLATE.format(
            institution=record.institution,
            apy=record.apy,
            link=chosen_link,
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
    # Resolve bank_link without Playwright: decode redirects, scrape anchors, then search fallback
    for rec in records:
        bank = resolve_bank_link_from_review(rec.nerdwallet_link, rec.institution, client)
        if not bank:
            bank = resolve_bank_link_by_search(rec.institution, client)
        rec.bank_link = bank
    fact_check_accounts(records, gemini_key)
    save_records(records)
    print(
        f"Saved {len(records)} accounts to "
        f"{os.path.relpath(os.getenv('OUTPUT_PATH') or DEFAULT_DATA_PATH)}"
    )


if __name__ == "__main__":
    run()
