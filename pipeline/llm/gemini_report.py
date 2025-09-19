from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-1.5-flash"


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
        "You are a banking analyst producing an executive-ready narrative for high-yield savings benchmarking.\n"
        "Summarize insights in 6 structured sections. Use the JSON schema provided.\n"
        "Focus on American Express vs. peers, highlight spreads, forecast takeaways, risks, and compliance notes.\n"
        "Input data summary:\n"
        f"{summary}\n"
        "Forecast metrics (p50 cost of funds): "
        f"{forecasts.get('metrics', {}).get('cost_of_funds', {}).get('p50', [])}\n"
        "Use concise bullet phrases for highlights, note scenario implications, and reference data freshness timestamps."
    )
    return prompt


def _fallback_narrative(data: Dict[str, Any]) -> Dict[str, Any]:
    snapshot = data.get("benchmark_snapshot", {})
    forecasts = data.get("forecasts", {})
    horizons = forecasts.get("horizons", [])
    cost_p50 = forecasts.get("metrics", {}).get("cost_of_funds", {}).get("p50", [])
    highlights = [
        "American Express maintains a competitive national APY profile.",
        "Peer median remains within a single-digit spread of AmEx, limiting share risk.",
        "Modeled scenarios keep NIM resilient under baseline and dovish paths.",
    ]
    return {
        "title": "American Express HYSA weekly benchmark",
        "highlights": highlights,
        "benchmarking": (
            "American Express prices within {spread} bps of the peer median and tracks close to top-tier offers."
        ).format(spread=snapshot.get("amex", {}).get("spread_to_median_bps", 0)),
        "forecast_insights": (
            f"Projected cost of funds across {horizons} centers on {cost_p50}. Scenario deltas remain manageable."
        ),
        "recommendations": "Hold current APY band while monitoring Ally and Capital One for fresh promotional pushes.",
        "risks": "Watch for rapid Fed repricing or promotional tiers that could accelerate outflows.",
        "compliance_block": "Narrative generated offline fallback; review prior to publication for accuracy.",
    }


def _extract_json(candidate: str) -> Dict[str, Any]:
    candidate = candidate.strip()
    if candidate.startswith("```"):
        candidate = candidate.strip("`\n")
        if candidate.startswith("json"):
            candidate = candidate[4:]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse Gemini response: %s", exc)
        raise


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
    }
    model = genai.GenerativeModel(model_name=DEFAULT_MODEL, generation_config=generation_config)
    try:
        response = model.generate_content(prompt)
    except Exception as exc:  # pragma: no cover - network fallbacks
        logger.error("Gemini generation failed (%s); using fallback", exc)
        return _fallback_narrative(data)
    text = getattr(response, "text", None) or getattr(response, "candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
    if not text:
        logger.error("Gemini returned empty response; using fallback")
        return _fallback_narrative(data)
    try:
        payload = _extract_json(text)
    except json.JSONDecodeError:
        return _fallback_narrative(data)
    expected_keys = {"title", "highlights", "benchmarking", "forecast_insights", "recommendations", "risks", "compliance_block"}
    if not expected_keys.issubset(payload.keys()):
        logger.warning("Gemini output missing keys; falling back")
        return _fallback_narrative(data)
    return payload
