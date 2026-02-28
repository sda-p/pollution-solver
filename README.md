# pollution-solver
Integrates world data and resolves concrete sustainability insights.

## PostgreSQL setup

### 0. Install project dependencies

```bash
npm install
```

### 1. Configure environment

```bash
cp .env.example .env
```

Default local settings:

- `host`: `localhost`
- `port`: `5432`
- `database`: `pollution_solver`
- `user`: `postgres`
- `password`: `postgres`

### 2. Start PostgreSQL

Option A (Docker Compose):

```bash
npm run db:up
```

Option B (Homebrew PostgreSQL 16 on macOS):

```bash
brew install postgresql@16
brew services start postgresql@16
```

### 3. Ingest datasets

```bash
npm run db:ingest
```

The ingestion script is idempotent and will:

- ensure role `postgres` and database `pollution_solver` exist
- create/update ingestion tables
- stream-import World Bank XML indicator data
- register Carbon Monitor NetCDF file metadata

### 4. Smoke-test with queries

```bash
npm run db:test
```

## Database structure

### `dataset_files`

Catalog of source files loaded into the system.

- `file_name TEXT PRIMARY KEY`
- `format TEXT NOT NULL`
- `size_bytes BIGINT NOT NULL`
- `sha256 TEXT`
- `container_type TEXT`
- `extracted_from TEXT`
- `record_count INTEGER`
- `notes TEXT`

### `world_bank_indicator_values`

Country/year values from the two World Bank XML datasets.

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

Tracked variables/attributes found in the Carbon Monitor NetCDF payload.

- `file_name TEXT NOT NULL` (FK -> `dataset_files.file_name`)
- `variable_name TEXT NOT NULL`
- `PRIMARY KEY (file_name, variable_name)`

## OpenStreetMap setup

This project includes an OpenStreetMap data path via Overpass API (`/osm/features`).

### Verify backend integration

Start backend:

```bash
npm start
```

Test OSM features via Overpass proxy:

```bash
curl -X POST http://localhost:3001/osm/features \
  -H "content-type: application/json" \
  -d '{"south":43.73,"west":7.41,"north":43.75,"east":7.45,"amenity":"hospital"}'
```

### Backend endpoints added

- `GET /insights`
  - Returns latest country-level World Bank energy-use values from PostgreSQL
  - Response: `{ pollutionPoints, meta }`

- `GET /insights/carbon-monitor`
  - Query params (optional): `stride`, `percentile`
  - Returns downsampled CarbonMonitor NetCDF emissions as an equirectangular RGBA bitmap payload
  - Response: `{ image: { width, height, rgbaBase64 }, meta }`

- `POST /osm/features`
  - Body:
    - `south`, `west`, `north`, `east` (required numeric bbox)
    - optional filters: `amenity`, `highway`
  - Returns: Overpass `elements` array

- `GET /osm/chunk`
  - Query:
    - `south`, `west`, `north`, `east` (required numeric bbox)
    - `lod` (`coarse` | `medium` | `fine`, optional)
    - `pixelSize` (optional)
  - Returns: road raster chunk payload `{ image: { width, height, rgbaBase64 }, meta }`

OSM chunking can be tuned with optional env vars:

- `OVERPASS_FALLBACK_URLS` (comma-separated alternate Overpass endpoints)
- `OVERPASS_MIN_INTERVAL_MS` (default `900`)
- `OVERPASS_MAX_RETRIES` (default `2`)
- `OSM_CHUNK_CACHE_DIR` (default `cache/osm-chunks`, persisted raster cache on disk)
- `OSM_CHUNK_DISK_TTL_MS` (default `2592000000` = 30 days)

Frontend helper functions are available in:

- `frontend/src/services/mobilityApi.js`

### Troubleshooting

- `docker: unknown command: docker compose`
  - Install/enable Docker Compose plugin in Docker Desktop.
