from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Dict

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-1.5-flash"
SCHEMA_KEYS = ("title", "summary", "highlights", "methodology")
SYSTEM_PROMPT = """You are a JSON generator. Produce ONLY JSON matching:\n{\n  \"title\": \"string\",\n  \"summary\": \"string\",\n  \"highlights\": [\"string\"],\n  \"methodology\": \"string\"\n}\nThe content should reflect the provided HYSA benchmarking metrics."""


def _condense_snapshot(data: Dict[str, Any]) -> str:
    snapshot = data.get("benchmark_snapshot", {})
    league = data.get("league_table", [])
    lines = [
        f"Primary bank APY: {snapshot.get('amex', {}).get('apy', 'n/a')} with spread {snapshot.get('amex', {}).get('spread_to_median_bps', 0)} bps",
        f"Peer median: {snapshot.get('peer_median', 'n/a')} | P75: {snapshot.get('peer_p75', 'n/a')}",
    ]
    leaders = ", ".join(f"{row['bank']} {row['apy']}%" for row in league[:5])
    lines.append(f"Top peers: {leaders}")
    return "\n".join(lines)


def _build_prompt(data: Dict[str, Any]) -> str:
    summary = _condense_snapshot(data)
    forecasts = data.get("forecasts", {})
    prompt = (
        f"SYSTEM:\n{SYSTEM_PROMPT}\n"
        "USER:\n"
        "Summarize HYSA benchmarking findings for executives.\n"
        "Focus on American Express vs peers, spreads, forecast insights, and compliance notes.\n"
        "Input data summary:\n"
        f"{summary}\n"
        "Forecast metrics (p50 cost of funds): "
        f"{forecasts.get('metrics', {}).get('cost_of_funds', {}).get('p50', [])}\n"
        "Always reply with valid JSON only."
    )
    return prompt


def _safe_json(payload: str) -> Dict[str, Any]:
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        start = payload.find("{")
        end = payload.rfind("}")
        if start == -1 or end == -1:
            raise
        return json.loads(payload[start : end + 1])


def _normalize_doc(raw: str) -> Dict[str, Any]:
    try:
        doc = _safe_json(raw)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse Gemini response: %s", exc)
        return {key: [] if key == "highlights" else "" for key in SCHEMA_KEYS}
    if not isinstance(doc, dict):
        doc = {}
    normalized: Dict[str, Any] = {}
    for key in SCHEMA_KEYS:
        value = doc.get(key)
        if key == "highlights":
            if not isinstance(value, list):
                value = [str(value)] if value else []
            normalized[key] = [str(item) for item in value]
        else:
            normalized[key] = str(value) if value else ""
    return normalized


def _fallback_narrative(data: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = data.get("benchmark_snapshot", {})
    highlights = [
        "American Express remains competitively positioned in HYSA rates.",
        "Peer spreads stay within manageable ranges across scenarios.",
        "Funding cost outlook shows limited downside under baseline assumptions.",
    ]
    return {
        "title": "American Express HYSA benchmark update",
        "summary": (
            "American Express tracks peer medians closely, maintaining spreads of "
            f"{snapshot.get('amex', {}).get('spread_to_median_bps', 0)} bps versus peers."
        ),
        "highlights": highlights,
        "methodology": "Narrative generated via fallback template; review prior to publication.",
    }


def generate_narrative(data: Dict[str, Any]) -> Dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning("GEMINI_API_KEY not configured; using fallback narrative")
        return _fallback_narrative(data)
    try:
        import google.generativeai as genai  # type: ignore
    except ImportError as exc:  # pragma: no cover - optional dependency
        logger.error("google-generativeai missing (%s); using fallback", exc)
        return _fallback_narrative(data)

    genai.configure(api_key=api_key)
    prompt = _build_prompt(data)
    generation_config = {
        "temperature": 0.2,
        "max_output_tokens": 1024,
        "response_mime_type": "application/json",
        "system_instruction": SYSTEM_PROMPT,
    }
    model = genai.GenerativeModel(model_name=DEFAULT_MODEL, generation_config=generation_config)

    attempts = 0
    while attempts < 3:
        attempts += 1
        try:
            response = model.generate_content(prompt)
            text = getattr(response, "text", None)
            if not text and getattr(response, "candidates", None):
                text = response.candidates[0].content.parts[0].text  # type: ignore[attr-defined]
            if not text:
                raise ValueError("Gemini returned empty response")
            normalized = _normalize_doc(text)
            missing = [key for key in SCHEMA_KEYS if not normalized.get(key)]
            if missing and attempts < 3:
                logger.warning("Gemini response missing keys %s; retrying", missing)
                time.sleep(1.5 * attempts)
                continue
            return normalized
        except Exception as exc:  # pragma: no cover - network fallbacks
            logger.error("Gemini generation failed (%s)", exc)
            time.sleep(1.5 * attempts)
    return _fallback_narrative(data)


__all__ = ["generate_narrative", "_normalize_doc"]
