from __future__ import annotations

import logging
import warnings
from dataclasses import dataclass
from datetime import date
from typing import Dict, Iterable, List

import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsmodels.tools.sm_exceptions import ConvergenceWarning

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


def _forecast(values: np.ndarray, steps: int) -> Dict[str, np.ndarray]:
    mean = values.mean()
    std = values.std() or 1.0
    scaled = (values - mean) / std
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", ConvergenceWarning)
            model = sm.tsa.SARIMAX(
                scaled,
                order=(1, 1, 1),
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
            result = model.fit(method="lbfgs", maxiter=1000, disp=False)
            forecast = result.get_forecast(steps=steps)
            mean_forecast = forecast.predicted_mean
            conf = forecast.conf_int(alpha=0.2)
            lower = conf.iloc[:, 0]
            upper = conf.iloc[:, 1]
    except Exception as exc:
        logger.warning("SARIMAX failed (%s); using ETS fallback", exc)
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        ets_model = ExponentialSmoothing(scaled, trend="add", seasonal=None)
        result = ets_model.fit(optimized=True)
        mean_forecast = result.forecast(steps)
        resid_std = np.std(result.resid, ddof=1) or 0.05
        lower = mean_forecast - 1.28 * resid_std
        upper = mean_forecast + 1.28 * resid_std

    mean_unscaled = mean_forecast * std + mean
    lower_unscaled = lower * std + mean
    upper_unscaled = upper * std + mean
    return {
        "p50": mean_unscaled,
        "p10": lower_unscaled,
        "p90": upper_unscaled,
    }


def _normalize_output(forecast: Dict[str, np.ndarray], horizons: List[int]) -> Dict[str, List[float]]:
    out = {"p10": [], "p50": [], "p90": []}
    for months in horizons:
        idx = max(0, min(months - 1, len(forecast["p50"]) - 1))
        out["p50"].append(round(float(forecast["p50"][idx]), 4))
        out["p10"].append(round(float(forecast["p10"][idx]), 4))
        out["p90"].append(round(float(forecast["p90"][idx]), 4))
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
    forecast_arrays = _forecast(series.to_numpy(dtype=float), steps)
    cost_of_funds = _normalize_output(forecast_arrays, HORIZONS)

    current_rate = float(series.iloc[-1])
    delta = np.array(cost_of_funds["p50"]) - current_rate
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
