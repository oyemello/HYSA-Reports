from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List

ISO_DATE = "%Y-%m-%d"


@dataclass
class LeagueRow:
    bank: str
    apy: float
    promo: bool
    delta_7d_bps: int
    delta_30d_bps: int
    aggregator_url: str
    official_url: str

    def as_dict(self) -> Dict[str, Any]:
        return {
            "bank": self.bank,
            "apy": round(self.apy, 4),
            "promo": self.promo,
            "delta_7d_bps": int(self.delta_7d_bps),
            "delta_30d_bps": int(self.delta_30d_bps),
            "source_urls": {
                "aggregator": self.aggregator_url,
                "official": self.official_url,
            },
        }


def _to_date(value: str | datetime | date) -> date:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    return datetime.strptime(value[:10], ISO_DATE).date()


def _append_point(series: List[Dict[str, Any]], as_of: date, value: float) -> List[Dict[str, Any]]:
    if series and _to_date(series[-1]["date"]) == as_of:
        series[-1]["value"] = round(value, 4)
        return series
    series.append({"date": as_of.strftime(ISO_DATE), "value": round(value, 4)})
    return series


def _lookup(series: List[Dict[str, Any]], as_of: date, delta: int) -> float | None:
    target = as_of - timedelta(days=delta)
    for entry in reversed(series):
        entry_date = _to_date(entry["date"])
        if entry_date <= target:
            return float(entry["value"])
    return None


def _delta_bps(current: float, prior: float | None) -> int:
    if prior is None or math.isnan(prior):
        return 0
    return int(round((current - prior) * 100))


def build_bank_time_series(
    verified: Iterable[Dict[str, Any]],
    previous_latest: Dict[str, Any] | None,
    as_of: date,
) -> Dict[str, List[Dict[str, Any]]]:
    prior_series = (previous_latest or {}).get("series", {}).get("bank_apys", {})
    combined: Dict[str, List[Dict[str, Any]]] = {
        bank: [dict(point) for point in series]
        for bank, series in prior_series.items()
    }
    for row in verified:
        bank = row["bank"]
        combined.setdefault(bank, [])
        combined[bank] = _append_point(combined[bank], as_of, float(row["official_apy"]))
    return combined


def build_league_table(
    verified: Iterable[Dict[str, Any]],
    bank_series: Dict[str, List[Dict[str, Any]]],
    as_of: date,
) -> List[Dict[str, Any]]:
    league: List[Dict[str, Any]] = []
    for row in verified:
        bank = row["bank"]
        series = bank_series.get(bank, [])
        current = float(row["official_apy"])
        prior_7 = _lookup(series, as_of, 7)
        prior_30 = _lookup(series, as_of, 30)
        league.append(
            LeagueRow(
                bank=bank,
                apy=current,
                promo=bool(row.get("promo")),
                delta_7d_bps=_delta_bps(current, prior_7),
                delta_30d_bps=_delta_bps(current, prior_30),
                aggregator_url=row.get("aggregator_url", ""),
                official_url=row.get("official_url", ""),
            ).as_dict()
        )
    league.sort(key=lambda item: item["apy"], reverse=True)
    return league


def banks_tracked(verified: Iterable[Dict[str, Any]]) -> List[str]:
    names = sorted({row["bank"] for row in verified})
    return names


def extract_discrepancies(verified: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    discrepancies: List[Dict[str, Any]] = []
    for row in verified:
        delta = row.get("discrepancy_bps", 0)
        if row.get("verification") == "aggregator_only":
            continue
        if delta:
            discrepancies.append(
                {
                    "bank": row["bank"],
                    "aggregator_apy": row.get("aggregator_apy"),
                    "official_apy": row.get("official_apy"),
                    "note": f"Official site diverges by {delta} bps",
                }
            )
    return discrepancies
