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

## OpenStreetMap + GraphHopper setup

This project now includes:

- OpenStreetMap data ingestion path via Overpass API (`/osm/features`)
- A local GraphHopper routing engine service (`/routing/route`)
- Frontend API helpers for future globe/routing integration

### 0. Prerequisites

- Docker Desktop installed and running
- Docker Compose available (`docker compose version`)
- Root dependencies installed:

```bash
npm install
```

### 1. Configure routing-related env vars

Already included in `.env.example`:

- `OVERPASS_URL` (default `https://overpass-api.de/api/interpreter`)
- `GRAPHHOPPER_BASE_URL` (default `http://localhost:8989`)
- `GRAPHHOPPER_PROFILE` (default `car`)
- `GRAPHHOPPER_API_KEY` (optional)
- `GRAPHHOPPER_OSM_FILE` (default `/data/osm/monaco-latest.osm.pbf`)

If `.env` does not exist:

```bash
cp .env.example .env
```

### 2. Download an OSM extract

Default (Monaco):

```bash
npm run osm:download
```

Or provide any `.osm.pbf` URL:

```bash
bash scripts/download_osm_extract.sh https://download.geofabrik.de/europe/france-latest.osm.pbf
```

### 3. Start GraphHopper

```bash
npm run routing:up
```

First start imports the OSM file and can take time depending on extract size.

Tail logs:

```bash
npm run routing:logs
```

Stop service:

```bash
npm run routing:down
```

### 4. Verify GraphHopper directly

```bash
curl "http://localhost:8989/route?point=43.7384,7.4246&point=43.7316,7.4198&profile=car&points_encoded=false"
```

Expected: JSON response with `paths[0].distance`, `paths[0].time`, and route geometry.

### 5. Verify backend integration

Start backend:

```bash
npm start
```

Test route via project API:

```bash
curl -X POST http://localhost:3001/routing/route \
  -H "content-type: application/json" \
  -d '{"fromLat":43.7384,"fromLng":7.4246,"toLat":43.7316,"toLng":7.4198,"profile":"car"}'
```

Test OSM features via Overpass proxy:

```bash
curl -X POST http://localhost:3001/osm/features \
  -H "content-type: application/json" \
  -d '{"south":43.73,"west":7.41,"north":43.75,"east":7.45,"amenity":"hospital"}'
```

### 6. Backend endpoints added

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

- `POST /routing/route`
  - Body:
    - `fromLat`, `fromLng`, `toLat`, `toLng` (required numeric coords)
    - optional `profile` (`car`, `bike`, `foot`, etc. configured in GraphHopper)
  - Returns: GraphHopper route response

Frontend helper functions are available in:

- `frontend/src/services/mobilityApi.js`

### Troubleshooting

- `docker: unknown command: docker compose`
  - Install/enable Docker Compose plugin in Docker Desktop.
- GraphHopper not reachable on `localhost:8989`
  - Check container state with `docker compose --profile routing ps`.
  - Inspect logs with `npm run routing:logs`.
- Slow first startup
  - Normal for larger `.osm.pbf` files while GraphHopper builds graph cache in `routing/graph-cache`.
