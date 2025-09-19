from __future__ import annotations

import logging
import os
from datetime import datetime
from pathlib import Path
from typing import Tuple

import pandas as pd

logger = logging.getLogger(__name__)

FRED_SERIES = "FEDFUNDS"
SEED_CSV = Path(__file__).with_name("fred_seed.csv")
ALLOW_SEED = os.getenv("ALLOW_SEED_MACRO") == "1"


def load_fed_funds(start: str | None = None) -> pd.DataFrame:
    api_key = os.getenv("FRED_API_KEY")
    if not api_key and not ALLOW_SEED:
        raise RuntimeError(
            "FRED_API_KEY is required. Set the environment variable or define ALLOW_SEED_MACRO=1 to use seed data."
        )

    try:
        from fredapi import Fred  # type: ignore
    except ImportError as exc:  # pragma: no cover - optional dependency
        logger.warning("fredapi unavailable (%s); using seed macro data", exc)
        return _load_from_seed()

    if not api_key:
        logger.warning("FRED_API_KEY not configured; using seed macro data")
        return _load_from_seed()

    try:
        fred = Fred(api_key=api_key)
        series = fred.get_series(FRED_SERIES, observation_start=start)
        df = series.rename("value").to_frame()
        df.index.name = "date"
        df = df.reset_index()
        df["date"] = pd.to_datetime(df["date"]).dt.date
        df = df.sort_values("date")
        logger.info("Loaded %s observations from FRED", len(df))
        return df
    except Exception as exc:  # pragma: no cover - network fallbacks
        logger.error("FRED fetch failed (%s); using seed macro data", exc)
        return _load_from_seed()


def _load_from_seed() -> pd.DataFrame:
    df = pd.read_csv(SEED_CSV, parse_dates=["date"]).sort_values("date")
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


def synthesize_peer_curves(fed_df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    frame = fed_df.copy()
    frame["value"] = frame["value"].astype(float)
    peer_median = frame.copy()
    peer_p75 = frame.copy()
    peer_median["value"] = (frame["value"] * 0.82).round(2).clip(lower=0.1)
    peer_p75["value"] = (frame["value"] * 0.9).round(2).clip(lower=0.15)
    return peer_median, peer_p75


def tail_window(df: pd.DataFrame, months: int = 120) -> pd.DataFrame:
    if "date" not in df:
        raise ValueError("Expected 'date' column in dataframe")
    df = df.sort_values("date")
    if months and len(df) > months:
        df = df.iloc[-months:]
    return df


def to_records(df: pd.DataFrame) -> list[dict[str, str | float]]:
    records = []
    for row in df.itertuples():
        dt_value = getattr(row, "date")
        if hasattr(dt_value, "strftime"):
            date_str = dt_value.strftime("%Y-%m-%d")
        else:
            date_str = datetime.fromtimestamp(dt_value).strftime("%Y-%m-%d")
        records.append({"date": date_str, "value": round(float(getattr(row, "value")), 4)})
    return records
