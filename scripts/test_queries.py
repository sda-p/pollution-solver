#!/usr/bin/env python3
import os
import shutil
import subprocess
import sys
from pathlib import Path


PG_BIN = Path("/opt/homebrew/opt/postgresql@16/bin")
PSQL = str(PG_BIN / "psql") if (PG_BIN / "psql").exists() else "psql"


def sh(cmd, env):
    return subprocess.run(cmd, check=True, text=True, capture_output=True, env=env)


def ensure_required_binaries():
    if shutil.which(PSQL) is None:
        raise RuntimeError(
            "Missing required PostgreSQL CLI tool: psql. Install PostgreSQL client tools and ensure psql is on PATH."
        )


def main():
    ensure_required_binaries()
    env = {
        **os.environ,
        "PGHOST": os.getenv("PGHOST", "localhost"),
        "PGPORT": os.getenv("PGPORT", "5432"),
        "PGUSER": os.getenv("PGUSER", "postgres"),
        "PGPASSWORD": os.getenv("PGPASSWORD", "postgres"),
        "PGDATABASE": os.getenv("PGDATABASE", "pollution_solver"),
    }

    queries = [
        (
            "row counts by source",
            """
SELECT dataset_file, COUNT(*) AS rows
FROM world_bank_indicator_values
GROUP BY dataset_file
ORDER BY dataset_file;
""",
        ),
        (
            "latest non-null values by indicator",
            """
SELECT indicator_code, MAX(year) AS latest_year_with_data
FROM world_bank_indicator_values
WHERE value IS NOT NULL
GROUP BY indicator_code
ORDER BY indicator_code;
""",
        ),
        (
            "carbon monitor metadata",
            """
SELECT df.file_name, df.format, df.size_bytes, array_agg(v.variable_name ORDER BY v.variable_name) AS variables
FROM dataset_files df
LEFT JOIN carbon_monitor_variables v ON v.file_name = df.file_name
WHERE df.file_name = 'CarbonMonitor_total_y2024_m12.nc'
GROUP BY df.file_name, df.format, df.size_bytes;
""",
        ),
    ]

    for label, sql in queries:
        out = sh([PSQL, "-v", "ON_ERROR_STOP=1", "-d", env["PGDATABASE"], "-c", sql], env)
        print(f"--- {label} ---")
        print(out.stdout.strip())
        print("")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as exc:
        print(exc.stdout or "", file=sys.stderr)
        print(exc.stderr or "", file=sys.stderr)
        raise
