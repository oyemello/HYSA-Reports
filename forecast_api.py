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
from google.generativeai import GenerativeModel, configure

FRED_API_KEY = os.getenv("FRED_API_KEY")
FRED_SERIES = [
    "FEDFUNDS", "GS10", "GS2", "T10Y3M", "CPIAUCSL", "UNRATE", "USREC"
]
FRED_BASE = "https://api.stlouisfed.org/fred/series/observations"

def get_gemini_summary(fred_data, competitor_apy, institution_apy, forecast):
    gemini_key = os.getenv("GEMINI_API_KEY")
    if not gemini_key:
        return "Gemini API key not set."
    configure(api_key=gemini_key)
    model = GenerativeModel("gemini-1.5-flash")
    prompt = f"""
You are an expert financial analyst. Summarize the following HYSA profitability forecast for an executive audience at American Express. Highlight the key macro drivers (FEDFUNDS, GS10), the current APY landscape, and the projected profitability for American Express compared to the federal funds rate scenario. Use clear, concise business language.

FRED data: {fred_data}
Competitor APY: {competitor_apy}
AMEX APY: {institution_apy}
Forecast: {forecast}
"""
    try:
        import threading
        result = {}
        def call_gemini():
            try:
                response = model.generate_content(prompt)
                result['text'] = response.text.strip() if response.text else "(No summary generated)"
            except Exception as e:
                result['text'] = f"Gemini error: {e}"
        t = threading.Thread(target=call_gemini)
        t.start()
        t.join(timeout=30)  # 30 second timeout
        if t.is_alive():
            return "Gemini summary timed out."
        return result.get('text', '(No summary generated)')
    except Exception as e:
        return f"Gemini error: {e}"

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
        obs_value = obs.get("value", "nan")
        try:
            value = float(obs_value)
            if value != value:  # NaN check
                value = None
        except Exception:
            value = None
        fred_data[series_id] = {
            "value": value,
            "date": obs.get("date", "")
        }

    # 2. Read competitor APY data
    apy_path = os.path.join(os.path.dirname(__file__), "frontend", "public", "data", "hysa_accounts.json")
    with open(apy_path) as f:
        competitor_apy = []
        for r in json.load(f):
            apy_str = str(r["apy"]).replace("%", "").strip()
            # Remove any non-numeric trailing text (e.g., '4.46 APY')
            apy_val = None
            for part in apy_str.split():
                try:
                    apy_val = float(part)
                    break
                except Exception:
                    continue
            if apy_val is not None:
                competitor_apy.append({"institution": r["institution"], "apy": apy_val})

    # 3. Use the highest APY as the institution's for demo
    institution_apy = max([r["apy"] for r in competitor_apy])

    # 4. Real forecast logic using FRED data
    # Use FEDFUNDS as cost of funds, GS10 as yield
    fedfunds = fred_data["FEDFUNDS"]["value"]
    gs10 = fred_data["GS10"]["value"]
    if fedfunds is None or gs10 is None:
        nim = [None, None, None]
        profit = [None, None, None]
        balances = [None, None, None]
        summary = "FRED data unavailable."
    else:
        months = [3, 6, 12]
        # Assume starting balance $1000, grows 2% every 6 months
        balances = [1000, 1020, 1040]
        # NIM = yield - cost of funds
        nim_val = gs10 - fedfunds
        nim = [round(nim_val, 2)] * 3
        # Profit = NIM% * avg balance * (months/12)
        profit = [round((n/12)*b*(nim_val/100), 2) for n, b in zip(months, balances)]
        summary = (
            f"Forecast uses GS10 ({gs10:.2f}%) as yield and FEDFUNDS ({fedfunds:.2f}%) as cost of funds. "
            f"NIM = {gs10:.2f} - {fedfunds:.2f} = {nim_val:.2f}%. "
            f"Profit is NIM% × avg balance × period."
        )

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
                "balances": balances,
                "cost_of_funds": [fedfunds]*3 if fedfunds is not None else [None]*3,
                "nim": nim,
                "profit": profit
            }
        },
        # Use Gemini to generate summary
        "summary": get_gemini_summary(fred_data, competitor_apy, institution_apy, {
            "months": [3, 6, 12],
            "balances": balances,
            "cost_of_funds": [fedfunds]*3 if fedfunds is not None else [None]*3,
            "nim": nim,
            "profit": profit
        })
    }
    return forecast

if __name__ == "__main__":
    # Generate up-to-date forecast.json for static frontend use
    output_path = os.path.join(os.path.dirname(__file__), "frontend", "public", "data", "forecast.json")
    with open(output_path, "w") as f:
        json.dump(get_forecast(), f, indent=2)
    print(f"Wrote forecast to {output_path}")
