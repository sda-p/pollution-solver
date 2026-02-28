#!/usr/bin/env python3
import csv
import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from netCDF4 import Dataset

ROOT = Path(__file__).resolve().parents[1]
DATASETS_DIR = ROOT / "datasets"
PG_BIN = Path("/opt/homebrew/opt/postgresql@16/bin")
PSQL = str(PG_BIN / "psql") if (PG_BIN / "psql").exists() else "psql"

CARBON_MONITOR_FILE = "CarbonMonitor_total_y2024_m12.nc"


def sh(cmd, env=None):
    return subprocess.run(cmd, check=True, text=True, capture_output=True, env=env)


def build_points_csv(nc_path):
    stride = max(1, int(os.getenv("CARBON_MONITOR_STRIDE", "20")))
    top_n = max(100, int(os.getenv("CARBON_MONITOR_TOP_N", "5000")))

    fd, csv_path = tempfile.mkstemp(prefix="carbon_monitor_points_", suffix=".csv")
    os.close(fd)

    with Dataset(str(nc_path)) as ds:
        lat = ds.variables["latitude"][::stride]
        lon = ds.variables["longitude"][::stride]
        emission_var = ds.variables["emission"][:, ::stride, ::stride]
        emission = np.ma.filled(emission_var, np.nan).astype(np.float64)
        emission = np.where(np.isfinite(emission), emission, 0.0)

        monthly_total = emission.sum(axis=0)
        max_daily = emission.max(axis=0)

        flat_total = monthly_total.ravel()
        nonzero_idx = np.where(flat_total > 0)[0]

        if nonzero_idx.size == 0:
            selected_idx = nonzero_idx
        elif nonzero_idx.size <= top_n:
            selected_idx = nonzero_idx
        else:
            scores = flat_total[nonzero_idx]
            pick = np.argpartition(scores, -top_n)[-top_n:]
            selected_idx = nonzero_idx[pick]

        lat_grid, lon_grid = np.meshgrid(lat, lon, indexing="ij")
        flat_lat = lat_grid.ravel()
        flat_lon = lon_grid.ravel()
        flat_max_daily = max_daily.ravel()
        selected_idx = selected_idx[np.argsort(flat_total[selected_idx])[::-1]]

        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            for idx in selected_idx:
                writer.writerow(
                    [
                        CARBON_MONITOR_FILE,
                        float(flat_lat[idx]),
                        float(flat_lon[idx]),
                        float(flat_total[idx]),
                        float(flat_max_daily[idx]),
                    ]
                )

    return Path(csv_path), int(selected_idx.size), stride, top_n


def main():
    env = {
        **os.environ,
        "PGHOST": os.getenv("PGHOST", "localhost"),
        "PGPORT": os.getenv("PGPORT", "5432"),
        "PGUSER": os.getenv("PGUSER", "postgres"),
        "PGPASSWORD": os.getenv("PGPASSWORD", "postgres"),
        "PGDATABASE": os.getenv("PGDATABASE", "pollution_solver"),
    }

    nc_path = DATASETS_DIR / CARBON_MONITOR_FILE
    if not nc_path.exists():
        raise SystemExit(f"Missing dataset: {nc_path}")

    setup_sql = f"""
CREATE TABLE IF NOT EXISTS carbon_monitor_points (
  id BIGSERIAL PRIMARY KEY,
  dataset_file TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  monthly_emission DOUBLE PRECISION NOT NULL,
  max_daily_emission DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_carbon_monitor_points_monthly
  ON carbon_monitor_points (monthly_emission DESC);

TRUNCATE TABLE carbon_monitor_points;
"""
    sh([PSQL, "-v", "ON_ERROR_STOP=1", "-d", env["PGDATABASE"], "-c", setup_sql], env=env)

    csv_path, rows, stride, top_n = build_points_csv(nc_path)
    try:
        copy_sql = r"\copy carbon_monitor_points (dataset_file, lat, lng, monthly_emission, max_daily_emission) FROM '{}' WITH (FORMAT csv)".format(
            str(csv_path)
        )
        sh([PSQL, "-v", "ON_ERROR_STOP=1", "-d", env["PGDATABASE"], "-c", copy_sql], env=env)
    finally:
        csv_path.unlink(missing_ok=True)

    print(f"Loaded carbon_monitor_points rows={rows} stride={stride} top_n={top_n}")


if __name__ == "__main__":
    main()
