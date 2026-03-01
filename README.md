# pollution-solver

Integrates world data and resolves concrete sustainability insights.

## What runs in this repo

- Node.js backend (`src/index.js`) on `http://localhost:3001`
- React/Vite frontend (`frontend/`) on `http://localhost:5173` (default)
- PostgreSQL database (`pollution_solver`)
- Python scripts for dataset ingestion and Carbon Monitor raster export

## Prerequisites

Install these before setup:

1. Node.js 20+ and npm
2. Python 3.10+
3. Docker (Docker Desktop on MacOS)
4. PostgreSQL **server** (or Docker for a Postgres container)
5. PostgreSQL CLI tools on your host: `psql` and `pg_isready`

For Carbon Monitor rendering (`GET /insights/carbon-monitor`), Python packages are required (see `requirements.txt`).

## Environment setup

1. Install JavaScript dependencies:

```bash
npm install
npm --prefix frontend install
```

Frontend runtime dependencies are managed in `frontend/package.json`. Key ones used by the app include:

- `react`
- `react-dom`
- `react-router-dom` (required by `frontend/src/main.jsx` for routing)
- `react-globe.gl`
- `three`

2. Create environment file:

```bash
cp .env.example .env
```

3. Review `.env` values:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pollution_solver
PGHOST=localhost
PGPORT=5432
PGDATABASE=pollution_solver
PGUSER=postgres
PGPASSWORD=postgres
OVERPASS_URL=https://overpass-api.de/api/interpreter
```

The backend now loads `.env` automatically at startup.

## Python setup

Create and activate a virtual environment, then install Python deps:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Notes:

- `scripts/ingest_datasets.py` and `scripts/test_queries.py` use only Python stdlib.
- `scripts/export_carbon_heatmap.py` needs `numpy` and `netCDF4`.

MacOS extras:

  brew install libpq
  echo 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"' >> ~/.zshrc
  source ~/.zshrc

  Then verify:

  which psql
  which pg_isready

  Then run:

  npm run db:ingest
  npm run db:test

## Database setup

### Option A: Docker Postgres

```bash
npm run db:up
```

### Option B: Local PostgreSQL (example: macOS Homebrew)

```bash
brew install postgresql@16
brew services start postgresql@16
```

Then run ingestion:

```bash
npm run db:ingest
npm run db:test
```

Ingestion is idempotent. It creates/refreshes:

- `dataset_files`
- `world_bank_indicator_values`
- `carbon_monitor_variables`

Datasets currently ingested into `world_bank_indicator_values`:

- `API_EG.USE.PCAP.KG.OE_DS2_en_xml_v2_3115.xml` (`EG.USE.PCAP.KG.OE`)
- `API_EG.EGY.PRIM.PP.KD_DS2_en_xml_v2_21105.xml` (`EG.EGY.PRIM.PP.KD`)
- `OWID_CB_CO2_PER_UNIT_ENERGY.csv` (`OWID_CB_CO2_PER_UNIT_ENERGY`)

## Run the app

Run backend + frontend together:

```bash
npm run dev
```

Or separately:

```bash
npm run dev:backend
npm run dev:frontend
```

Debug overlays (OSM/debug panels) are hidden by default in the globe UI. Press `B` to toggle them on/off.

Production-style backend run:

```bash
npm start
```

## Verify pollution insights

Check API directly:

```bash
curl http://localhost:3001/insights
```

Expected shape:

```json
{
  "pollutionPoints": [...],
  "countryData": {...},
  "meta": {...}
}
```

## Why pollution insights fail to load

`GET /insights` fails when backend cannot query `world_bank_indicator_values`.

Most common causes:

1. PostgreSQL is not running.
2. Dataset ingestion was never run (or failed).
3. `psql`/`pg_isready` is missing, so `npm run db:ingest` cannot initialize data.
4. `.env` values don’t match your local DB instance.

Fast checks:

```bash
# 1) Verify psql tools exist
which psql
which pg_isready

# 2) Verify DB is reachable
pg_isready -h localhost -p 5432

# 3) Verify data exists
npm run db:test

# 4) Inspect backend errors
npm run dev:backend
```

If ingestion fails because `psql` is missing, install PostgreSQL client tools and rerun `npm run db:ingest`.

## API endpoints

- `GET /insights`
- `GET /insights/carbon-monitor?stride=8&percentile=99.3`
- `POST /osm/features`
- `GET /osm/chunk`
- `GET /osm/reverse`
- `GET /osm/search`
- `POST /routing/route`

Frontend API client is in `frontend/src/services/mobilityApi.js`.

## Database schema

### `dataset_files`

- `file_name TEXT PRIMARY KEY`
- `format TEXT NOT NULL`
- `size_bytes BIGINT NOT NULL`
- `sha256 TEXT`
- `container_type TEXT`
- `extracted_from TEXT`
- `record_count INTEGER`
- `notes TEXT`

### `world_bank_indicator_values`

- `dataset_file TEXT NOT NULL` (FK -> `dataset_files.file_name`)
- `country_code TEXT NOT NULL`
- `country_name TEXT NOT NULL`
- `indicator_code TEXT NOT NULL`
- `indicator_name TEXT NOT NULL`
- `year INTEGER NOT NULL`
- `value DOUBLE PRECISION`
- `PRIMARY KEY (dataset_file, country_code, indicator_code, year)`

Indexes:

- `idx_world_bank_indicator_year (indicator_code, year)`
- `idx_world_bank_country (country_code, year)`

### `carbon_monitor_variables`

- `file_name TEXT NOT NULL` (FK -> `dataset_files.file_name`)
- `variable_name TEXT NOT NULL`
- `PRIMARY KEY (file_name, variable_name)`
