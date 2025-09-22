# HYSA Reports

Tools to scrape NerdWallet's high-yield savings account roundup with Firecrawl, fact-check the results with Gemini, and publish them to a Vite + Tailwind dashboard.

## Prerequisites

- Python 3.10+
- Node.js 18+
- Firecrawl API key (`FIRECRAWL_API_KEY`)
- Gemini API key (`GEMINI_API_KEY`, optional but required for automatic fact checks)

## Setup

### 1. Python scraper

```bash
cd scraper
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example ../.env  # update with your keys
python scrape_hysa.py
```

The scraper writes `frontend/public/data/hysa_accounts.json` by default. Override the destination with the `OUTPUT_PATH` environment variable if needed.

### 2. Frontend dashboard

```bash
cd frontend
npm install
npm run dev
```

Open the provided URL to view the American Express-styled table of institutions, APY, source links, and double-check status. Re-run the scraper and refresh the page to pull new data.

## Fact-check workflow

When `GEMINI_API_KEY` is available, each row is sent to Gemini with the source link to validate the APY. The dashboard shows a green check for verified rows, a red cross for mismatches, and an amber dot when fact checking was skipped or inconclusive. Hover over the status to see the model's note.

