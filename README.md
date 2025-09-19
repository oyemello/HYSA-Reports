# HYSA Benchmark POC

Production-ready proof of concept that benchmarks American Express High Yield Savings against peer banks, projects 3/6/12 month outcomes, and publishes a Gemini-authored executive narrative. GitHub Actions refreshes the `/data` artifacts and deploys the Vite + React dashboard to GitHub Pages.

## Key capabilities
- Crawl NerdWallet to discover competitors, then verify APYs against official product pages with crawl4ai + graceful fallbacks.
- Maintain `/data/latest.json` and append history snapshots for reproducible timelines.
- Compute peer medians/p75 overlays, AmEx spreads, and simple SARIMAX-based funding/NIM outlooks.
- Generate Gemini JSON narratives (with offline fallback) that are rendered in the SPA and included verbatim in the PDF snapshot.
- Vite + React + Tailwind single-page dashboard with Recharts visualizations, league table, onboarding modal, and html2canvas + jsPDF export.
- GitHub Actions workflow schedules daily refreshes, commits data updates, builds the site, and publishes to Pages.

## Architecture
| Layer | Details |
| --- | --- |
| Data pipeline | `pipeline/run_pipeline.py` orchestrates crawl4ai scrapers, pandas transforms, SARIMAX forecasts (`statsmodels`), and Gemini narrative generation. Artifacts land under `data/` and history snapshots are auto-committed. |
| Scraping | `pipeline/sources/nerdwallet.py` seeds from NerdWallet then `pipeline/sources/bank_verify.py` visits mapped official URLs. Robots directives respected; fallback seed data keeps pipeline stable without network. |
| Macro inputs | `pipeline/sources/fed_macro.py` pulls Fed Funds via `fredapi` when available, with a bundled 10-year seed CSV fallback. Peer medians/p75 synthesize from Fed front-end behavior. |
| Forecasting | `pipeline/transform/forecasts.py` fits SARIMAX where history allows and degrades to drift bands, translating into cost-of-funds, deposit volume, and NIM quantiles. |
| Frontend | `/site` Vite + React + TypeScript + Tailwind + Zustand state. Recharts drives time-series overlays, scenario cards, and interactive league table. PDF export button snapshots the dashboard section users see. |
| Hosting | `.github/workflows/data-pipeline.yml` runs on schedule & dispatch, installs Python deps, calls the pipeline, and then builds/deploys `/site/dist` to GitHub Pages. The build copies `/data` into the published artifact so the SPA consumes static JSON. |

## Local development
1. **Dashboard**
   ```bash
   cd site
   npm install
   npm run dev
   ```
   Opens Vite dev server (defaults to <http://localhost:5173>). The SPA fetches `/data/latest.json` locally and shows the onboarding modal on first load.

2. **Pipeline**
   ```bash
   pip install -r pipeline/requirements.txt
   python -m pipeline.run_pipeline
   ```
   Fallback seed data makes the run deterministic when crawling or Gemini access is unavailable. Any refreshed artifacts are written to `/data/latest.json` and `/data/history/`.

## GitHub Actions & Pages
- Workflow file: `.github/workflows/data-pipeline.yml`
  - `build-data` job installs Python 3.11 dependencies and runs the pipeline with `GEMINI_API_KEY` (if set) available.
  - `build-site` job performs `npm ci && npm run build`, which also copies `/data` into the Pages artifact.
  - `deploy` job publishes the artifact to the `github-pages` environment.
- Permissions include `contents: write` so the pipeline can commit refreshed JSON back to `main`.

## Data contract
`/data/latest.json` follows the schema defined in the project brief (series, benchmarks, forecasts, narrative, audit trail). Each run adds an ISO8601-stamped snapshot to `/data/history/`. The SPA renders these fields directly so anything present in the PDF download already exists on the page.

## Environment notes
- Scrapers use a custom user agent and obey rate limits. Official-site mappings live in `pipeline/sources/bank_verify.py` and can be extended easily.
- Gemini narrative generation runs only inside GitHub Actions (or locally if you export `GEMINI_API_KEY`). The frontend never accesses secrets.
- Fed history falls back to the bundled `pipeline/sources/fred_seed.csv`. Replace with a live FRED pull by setting the `FRED_API_KEY` or editing `load_fed_funds`.

## Repository URL assumption
Documentation references `https://github.com/<me>/<my-hysa-poc>`; update the placeholder after creating your repository.

## NEXT STEPS
1. **Add Gemini secret** – In the GitHub repo settings, create `Settings → Secrets and variables → Actions → New repository secret` named `GEMINI_API_KEY` with your Gemini key.
2. **Enable Pages** – In `Settings → Pages`, set the source to “GitHub Actions” so the deploy job can publish.
3. **Trigger initial run** – Visit `Actions → Data Pipeline → Run workflow` to produce the first `/data/latest.json` and deploy the dashboard.
4. **Adjust schedule** – Edit `.github/workflows/data-pipeline.yml` to change the `cron` expression if you need a different refresh cadence.
5. **Tune priors** – Modify `pipeline/transform/forecasts.py` (`ForecastAssumptions`) to tweak beta/elasticity or base NIM assumptions.
