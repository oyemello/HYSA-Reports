from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import Dict, Iterable, List

import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX

logger = logging.getLogger(__name__)

HORIZONS = [3, 6, 12]


@dataclass
class ForecastAssumptions:
    beta: float = 0.5
    elasticity: float = -0.8
    nim_base: float = 1.82


def _series_to_monthly(series: Iterable[Dict[str, float]]) -> pd.Series:
    frame = pd.DataFrame(series)
    frame["date"] = pd.to_datetime(frame["date"])
    frame = frame.sort_values("date").set_index("date")
    monthly = frame.resample("ME").last().ffill()
    return monthly["value"]


def _fit_sarimax(values: pd.Series, steps: int) -> pd.DataFrame:
    if len(values) < 6:
        logger.warning("Insufficient history (%s points) for SARIMAX; using naive forecast", len(values))
        last = values.iloc[-1]
        index = pd.date_range(values.index[-1] + pd.offsets.MonthEnd(1), periods=steps, freq="M")
        mean = np.full(steps, last)
        p10 = mean - 0.1
        p90 = mean + 0.1
        return pd.DataFrame({"mean": mean, "p10": p10, "p90": p90}, index=index)
    model = SARIMAX(
        values,
        order=(1, 1, 1),
        seasonal_order=(0, 0, 0, 0),
        trend="c",
        enforce_stationarity=False,
        enforce_invertibility=False,
    )
    try:
        fit = model.fit(disp=False)
        forecast = fit.get_forecast(steps=steps)
        conf = forecast.conf_int(alpha=0.2)  # 80% interval ~ p10/p90
        mean = forecast.predicted_mean
        idx = mean.index
        return pd.DataFrame(
            {
                "mean": mean.values,
                "p10": conf.iloc[:, 0].values,
                "p90": conf.iloc[:, 1].values,
            },
            index=idx,
        )
    except Exception as exc:
        logger.error("SARIMAX fitting failed (%s); using fallback", exc)
        last = values.iloc[-1]
        index = pd.date_range(values.index[-1] + pd.offsets.MonthEnd(1), periods=steps, freq="M")
        mean = np.full(steps, last)
        p10 = mean - 0.1
        p90 = mean + 0.1
        return pd.DataFrame({"mean": mean, "p10": p10, "p90": p90}, index=index)


def _normalize_output(frame: pd.DataFrame, horizons: List[int]) -> Dict[str, List[float]]:
    out = {"p10": [], "p50": [], "p90": []}
    for months in horizons:
        idx = months - 1
        idx = min(idx, len(frame) - 1)
        out["p50"].append(round(float(frame.iloc[idx]["mean"]), 4))
        out["p10"].append(round(float(frame.iloc[idx]["p10"]), 4))
        out["p90"].append(round(float(frame.iloc[idx]["p90"]), 4))
    return out


def _scenario_paths(latest_fed: float) -> Dict[str, Dict[str, List[float] | str]]:
    baseline = [round(latest_fed - 0.05 * step, 2) for step in range(len(HORIZONS))]
    hawkish = [round(latest_fed + max(0, 0.03 - 0.01 * step), 2) for step in range(len(HORIZONS))]
    dovish = [round(max(latest_fed - 0.15 - 0.05 * step, 0.0), 2) for step in range(len(HORIZONS))]
    return {
        "baseline": {
            "fed_path": baseline,
            "description": "Base case leans on futures-implied gentle cuts.",
        },
        "hawkish": {
            "fed_path": hawkish,
            "description": "Sticky inflation slows the easing cycle, nudging funding costs higher.",
        },
        "dovish": {
            "fed_path": dovish,
            "description": "Growth wobbles drive a faster cutting cadence supporting NIM expansion.",
        },
    }


def build_forecasts(
    bank_series: Dict[str, List[Dict[str, float]]],
    peer_median: pd.DataFrame,
    fed_df: pd.DataFrame,
    as_of: date,
    assumptions: ForecastAssumptions | None = None,
) -> Dict[str, Any]:
    assumptions = assumptions or ForecastAssumptions()
    amex_series = bank_series.get("American Express") or next(iter(bank_series.values()))
    series = _series_to_monthly(amex_series)
    steps = max(HORIZONS)
    outcome = _fit_sarimax(series, steps)
    cost_of_funds = _normalize_output(outcome, HORIZONS)

    current_rate = series.iloc[-1]
    delta = np.array(cost_of_funds["p50"]) - current_rate
    # deposit volume index anchored at 100
    deposit_p50 = 100 * (1 + (-assumptions.elasticity) * delta / 100)
    deposit_p10 = deposit_p50 * 0.98
    deposit_p90 = deposit_p50 * 1.02

    nim_base = assumptions.nim_base
    nim_p50 = nim_base + (-assumptions.beta) * (np.array(cost_of_funds["p50"]) - current_rate)
    nim_p10 = nim_p50 - 0.05
    nim_p90 = nim_p50 + 0.05

    latest_fed = float(fed_df.iloc[-1]["value"]) if not fed_df.empty else 0.0

    def round_list(values: Iterable[float]) -> List[float]:
        return [round(float(v), 4) for v in values]

    metrics = {
        "cost_of_funds": {
            "p10": cost_of_funds["p10"],
            "p50": cost_of_funds["p50"],
            "p90": cost_of_funds["p90"],
        },
        "deposit_volume": {
            "p10": round_list(deposit_p10),
            "p50": round_list(deposit_p50),
            "p90": round_list(deposit_p90),
        },
        "nim": {
            "p10": round_list(nim_p10),
            "p50": round_list(nim_p50),
            "p90": round_list(nim_p90),
        },
    }

    return {
        "horizons": [f"{h}m" for h in HORIZONS],
        "assumptions": {
            "beta": assumptions.beta,
            "elasticity": assumptions.elasticity,
            "note": "industry priors, adjustable later",
        },
        "scenarios": _scenario_paths(latest_fed),
        "metrics": metrics,
    }
