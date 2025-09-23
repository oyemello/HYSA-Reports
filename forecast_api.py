# forecast_api.py
"""
A minimal FastAPI backend to fetch FRED macro data, ingest competitor APY data, and return a profitability forecast for HYSA products.
- Fetches FRED series (FEDFUNDS, GS10, GS2, T10Y3M, CPIAUCSL, UNRATE, USREC)
- Reads competitor APY data from the frontend/public/data/hysa_accounts.json file
- Returns a structured JSON forecast and summary
"""
import os
import json
from datetime import datetime
from typing import List, Dict, Any
import requests
from fastapi import FastAPI
from pydantic import BaseModel

FRED_API_KEY = os.getenv("FRED_API_KEY")
FRED_SERIES = [
    "FEDFUNDS", "GS10", "GS2", "T10Y3M", "CPIAUCSL", "UNRATE", "USREC"
]
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

app = FastAPI()

class APYRecord(BaseModel):
    institution: str
    apy: float

class ForecastRequest(BaseModel):
    institution_apy: float
    competitor_apy: List[APYRecord]

@app.get("/api/forecast")
def get_forecast():
    # 1. Fetch FRED data
    fred_data = {}
    for series_id in FRED_SERIES:
        params = {
            "series_id": series_id,
            "api_key": FRED_API_KEY,
            "file_type": "json",
            "sort_order": "desc",
            "limit": 1
        }
        resp = requests.get(FRED_BASE, params=params)
        obs = resp.json().get("observations", [{}])[0]
        fred_data[series_id] = {
            "value": float(obs.get("value", "nan")),
            "date": obs.get("date", "")
        }

    # 2. Read competitor APY data
    apy_path = os.path.join(os.path.dirname(__file__), "frontend", "public", "data", "hysa_accounts.json")
    with open(apy_path) as f:
        competitor_apy = [
            {"institution": r["institution"], "apy": float(r["apy"].replace("%", ""))}
            for r in json.load(f)
            if r.get("apy")
        ]

    # 3. Use the highest APY as the institution's for demo
    institution_apy = max([r["apy"] for r in competitor_apy])

    # 4. Dummy forecast logic (replace with real model as needed)
    forecast = {
        "run_date": datetime.now().strftime("%Y-%m-%d"),
        "fred_vintage": fred_data["FEDFUNDS"]["date"],
        "inputs": {
            "FRED": fred_data,
            "competitor_apy": competitor_apy,
            "institution_apy": institution_apy
        },
        "forecast": {
            "base": {
                "months": [3, 6, 12],
                "balances": [1000, 1020, 1050],
                "cost_of_funds": [institution_apy, institution_apy-0.05, institution_apy-0.1],
                "nim": [1.10, 1.05, 1.00],
                "profit": [12, 24, 48]
            }
        },
        "summary": "This is a demo. Replace with real model output."
    }
    return forecast

if __name__ == "__main__":
    # Generate up-to-date forecast.json for static frontend use
    output_path = os.path.join(os.path.dirname(__file__), "frontend", "public", "data", "forecast.json")
    with open(output_path, "w") as f:
        json.dump(get_forecast(), f, indent=2)
    print(f"Wrote forecast to {output_path}")
