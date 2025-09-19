from __future__ import annotations

from datetime import date
from typing import Any, Dict, Iterable, List

import pandas as pd

from pipeline.sources.fed_macro import tail_window, to_records


def latest_value(df: pd.DataFrame) -> float:
    if df.empty:
        return 0.0
    return float(df.iloc[-1]["value"])


def build_series_payload(
    fed_df: pd.DataFrame,
    peer_median_df: pd.DataFrame,
    peer_p75_df: pd.DataFrame,
    bank_series: Dict[str, List[Dict[str, Any]]],
    months: int = 120,
) -> Dict[str, Any]:
    bundle = {
        "fed_effective": to_records(tail_window(fed_df, months)),
        "peer_median_hysa": to_records(tail_window(peer_median_df, months)),
        "peer_p75_hysa": to_records(tail_window(peer_p75_df, months)),
        "bank_apys": {},
    }
    for bank, series in bank_series.items():
        trimmed = series[-months:] if months else series
        bundle["bank_apys"][bank] = trimmed
    return bundle


def compute_snapshot(
    league_table: Iterable[Dict[str, Any]],
    peer_median_df: pd.DataFrame,
    peer_p75_df: pd.DataFrame,
    bank_series: Dict[str, List[Dict[str, Any]]],
    primary_bank: str,
) -> Dict[str, Any]:
    ordered = list(league_table)
    leader = ordered[0] if ordered else None
    primary_entry = next((row for row in ordered if row["bank"] == primary_bank), None)
    primary_rank = ordered.index(primary_entry) + 1 if primary_entry else 0
    peer_median = latest_value(peer_median_df)
    peer_p75 = latest_value(peer_p75_df)
    amex_apy = float(primary_entry["apy"]) if primary_entry else 0.0
    spread_to_median = int(round((amex_apy - peer_median) * 100))
    return {
        "leader": {
            "bank": leader["bank"] if leader else "",
            "apy": float(leader["apy"]) if leader else 0.0,
        },
        "peer_median": round(peer_median, 4),
        "peer_p75": round(peer_p75, 4),
        "amex": {
            "apy": round(amex_apy, 4),
            "rank": primary_rank,
            "spread_to_median_bps": spread_to_median,
        },
    }


def build_audit_sources(verified: Iterable[Dict[str, Any]]) -> List[Dict[str, str]]:
    audits: List[Dict[str, str]] = []
    for row in verified:
        aggregator = row.get("aggregator_url")
        official = row.get("official_url")
        if aggregator and {"name": "NerdWallet", "url": aggregator} not in audits:
            audits.append({"name": "NerdWallet", "url": aggregator})
        if official:
            audits.append({"name": row["bank"], "url": official})
    return audits
