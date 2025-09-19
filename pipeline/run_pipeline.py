from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path

from rich.logging import RichHandler

from pipeline.llm.gemini_report import generate_narrative
from pipeline.sources.bank_verify import verify_competitors
from pipeline.sources.fed_macro import load_fed_funds, synthesize_peer_curves
from pipeline.sources.nerdwallet import fetch_competitors
from pipeline.transform.benchmarks import (
    build_audit_sources,
    build_series_payload,
    compute_snapshot,
)
from pipeline.transform.forecasts import ForecastAssumptions, build_forecasts
from pipeline.transform.normalize import (
    banks_tracked,
    build_bank_time_series,
    build_league_table,
    extract_discrepancies,
)
from pipeline.utils.io import ensure_dir, git_commit, git_diff_paths, read_json, snapshot_history, utc_now, write_json

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    datefmt="%H:%M:%S",
    handlers=[RichHandler(markup=False, rich_tracebacks=True)],
)
logger = logging.getLogger(__name__)

PRIMARY_BANK = "American Express"
DATA_DIR = Path("data")
LATEST_PATH = DATA_DIR / "latest.json"
HISTORY_DIR = DATA_DIR / "history"


def load_previous_latest() -> dict | None:
    if not LATEST_PATH.exists():
        return None
    try:
        return read_json(LATEST_PATH)
    except json.JSONDecodeError:
        logger.warning("Existing latest.json is not valid JSON; ignoring")
        return None


def orchestrate() -> dict:
    as_of = utc_now()
    previous_latest = load_previous_latest()

    logger.info("Fetching competitors from NerdWallet seed ...")
    competitors = fetch_competitors(limit=20)

    logger.info("Verifying official site APYs ...")
    verified = verify_competitors(competitors)

    logger.info("Loading macro series (Fed funds + peer curves)...")
    fed_df = load_fed_funds()
    peer_median_df, peer_p75_df = synthesize_peer_curves(fed_df)

    as_of_date = as_of.date()
    logger.info("Building normalized bank time series ...")
    bank_series = build_bank_time_series(verified, previous_latest, as_of_date)
    league_table = build_league_table(verified, bank_series, as_of_date)

    logger.info("Computing benchmark snapshot ...")
    series_payload = build_series_payload(fed_df, peer_median_df, peer_p75_df, bank_series)
    snapshot = compute_snapshot(league_table, peer_median_df, peer_p75_df, bank_series, PRIMARY_BANK)

    logger.info("Running forecast engine ...")
    forecasts = build_forecasts(
        bank_series=bank_series,
        peer_median=peer_median_df,
        fed_df=fed_df,
        as_of=as_of_date,
        assumptions=ForecastAssumptions(),
    )

    logger.info("Assembling data payload ...")
    payload = {
        "as_of": as_of.isoformat(),
        "primary_bank": PRIMARY_BANK,
        "banks_tracked": banks_tracked(verified),
        "series": series_payload,
        "benchmark_snapshot": snapshot,
        "league_table": league_table,
        "forecasts": forecasts,
    }

    logger.info("Generating Gemini narrative ...")
    narrative = generate_narrative(payload)
    payload["narrative"] = narrative

    logger.info("Preparing audit metadata ...")
    payload["audit"] = {
        "sources": build_audit_sources(verified),
        "discrepancies": extract_discrepancies(verified),
        "data_freshness": {
            "competitor_rates": as_of.isoformat(),
            "fed_series": fed_df.iloc[-1]["date"].isoformat() if not fed_df.empty else as_of.isoformat(),
        },
    }

    return payload


def main() -> None:
    dataset = orchestrate()
    ensure_dir(LATEST_PATH.parent)
    logger.info("Writing %s", LATEST_PATH)
    write_json(LATEST_PATH, dataset)
    history_path = snapshot_history(LATEST_PATH, HISTORY_DIR, utc_now())
    logger.info("Snapshot stored at %s", history_path)

    if git_diff_paths([LATEST_PATH, HISTORY_DIR]):
        logger.info("Detected changes; committing to repository")
        git_commit([LATEST_PATH, HISTORY_DIR], "chore: refresh HYSA dataset")
    else:
        logger.info("No changes detected; skipping commit")


if __name__ == "__main__":
    main()
