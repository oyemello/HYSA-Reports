from __future__ import annotations

import json

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from pipeline.llm.gemini_report import _normalize_doc
from pipeline.sources.bank_verify import _extract_apy


def test_extract_apy_various_formats() -> None:
    samples = [
        "Earn a competitive 4.25% APY on every dollar.",
        "Annual Percentage Yield (APY) currently 5.05 % for balances above $5,000.",
        "Our APY — 3.90% — adjusts monthly.",
    ]
    expected = [4.25, 5.05, 3.90]
    for text, target in zip(samples, expected, strict=False):
        assert _extract_apy(text) == target


def test_extract_apy_returns_none_when_missing() -> None:
    assert _extract_apy("No rate disclosed.") is None


def test_normalize_doc_repairs_malformed_json() -> None:
    broken = "garbage {\"title\": \"T\", \"summary\": null, \"highlights\": \"single\"} trailing"
    doc = _normalize_doc(broken)
    assert set(doc.keys()) == {"title", "summary", "highlights", "methodology"}
    assert doc["title"] == "T"
    assert doc["summary"] == ""
    assert doc["highlights"] == ["single"]
    assert doc["methodology"] == ""


def test_normalize_doc_handles_non_dict_payload() -> None:
    payload = json.dumps(["not", "a", "dict"])
    doc = _normalize_doc(payload)
    assert doc == {"title": "", "summary": "", "highlights": [], "methodology": ""}
