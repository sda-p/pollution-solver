#!/usr/bin/env python3
import csv
import hashlib
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATASETS_DIR = ROOT / "datasets"
PG_BIN = Path("/opt/homebrew/opt/postgresql@16/bin")
PSQL = str(PG_BIN / "psql") if (PG_BIN / "psql").exists() else "psql"
PG_ISREADY = str(PG_BIN / "pg_isready") if (PG_BIN / "pg_isready").exists() else "pg_isready"


XML_FILES = [
    "API_EG.EGY.PRIM.PP.KD_DS2_en_xml_v2_21105.xml",
    "API_EG.USE.PCAP.KG.OE_DS2_en_xml_v2_3115.xml",
]


def sh(cmd, env=None, check=True, capture_output=False):
    return subprocess.run(
        cmd,
        check=check,
        env=env,
        text=True,
        capture_output=capture_output,
    )


def ensure_required_binaries():
    missing = []
    if shutil.which(PSQL) is None:
        missing.append("psql")
    if shutil.which(PG_ISREADY) is None:
        missing.append("pg_isready")

    if missing:
        missing_text = ", ".join(missing)
        raise RuntimeError(
            "Missing required PostgreSQL CLI tools: "
            f"{missing_text}. Install PostgreSQL client tools and ensure they are on PATH."
        )


def get_pg_env():
    # Bootstrap with postgres credentials expected by this project.
    return {
        **os.environ,
        "PGHOST": os.getenv("PGHOST", "localhost"),
        "PGPORT": os.getenv("PGPORT", "5432"),
        "PGUSER": os.getenv("PGUSER", "postgres"),
        "PGPASSWORD": os.getenv("PGPASSWORD", "postgres"),
        "PGDATABASE": os.getenv("PGDATABASE", "postgres"),
    }


def ensure_server_up(env):
    sh([PG_ISREADY, "-h", env["PGHOST"], "-p", env["PGPORT"]], env=env)


def ensure_role_and_database(env):
    role_sql = r"""
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres LOGIN PASSWORD 'postgres';
  ELSE
    ALTER ROLE postgres WITH LOGIN PASSWORD 'postgres';
  END IF;
END
$$;
"""
    sh([PSQL, "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c", role_sql], env=env)

    exists = sh(
        [PSQL, "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-tAc", "SELECT 1 FROM pg_database WHERE datname='pollution_solver'"],
        env=env,
        capture_output=True,
    ).stdout.strip()
    if exists != "1":
        sh(
            [PSQL, "-v", "ON_ERROR_STOP=1", "-d", "postgres", "-c", "CREATE DATABASE pollution_solver OWNER postgres"],
            env=env,
        )


def parse_xml_to_csv(xml_path, writer):
    rows = 0
    non_null_values = 0

    # streaming parse: only keep one <record> in memory at a time
    context = ET.iterparse(xml_path, events=("start", "end"))
    _, root = next(context)

    for event, elem in context:
        if event != "end" or elem.tag != "record":
            continue

        data = {}
        keys = {}
        for field in elem.findall("field"):
            name = field.attrib.get("name")
            data[name] = (field.text or "").strip()
            if "key" in field.attrib:
                keys[name] = field.attrib["key"]

        value_raw = data.get("Value", "")
        value = None
        if value_raw != "":
            value = float(value_raw)
            non_null_values += 1

        writer.writerow(
            [
                xml_path.name,
                keys.get("Country or Area", ""),
                data.get("Country or Area", ""),
                keys.get("Item", ""),
                data.get("Item", ""),
                int(data["Year"]),
                value,
            ]
        )
        rows += 1
        elem.clear()
        root.clear()

    return rows, non_null_values


def sha256_of_file(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def build_world_bank_csv():
    fd, csv_path = tempfile.mkstemp(prefix="world_bank_", suffix=".csv")
    os.close(fd)

    totals = {}
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        for filename in XML_FILES:
            xml_path = DATASETS_DIR / filename
            rows, non_null_values = parse_xml_to_csv(xml_path, writer)
            totals[filename] = {"rows": rows, "non_null_values": non_null_values}
    return Path(csv_path), totals


def ingest(env):
    sql = """
CREATE TABLE IF NOT EXISTS dataset_files (
  file_name TEXT PRIMARY KEY,
  format TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  sha256 TEXT,
  container_type TEXT,
  extracted_from TEXT,
  record_count INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS world_bank_indicator_values (
  dataset_file TEXT NOT NULL REFERENCES dataset_files(file_name),
  country_code TEXT NOT NULL,
  country_name TEXT NOT NULL,
  indicator_code TEXT NOT NULL,
  indicator_name TEXT NOT NULL,
  year INTEGER NOT NULL,
  value DOUBLE PRECISION,
  PRIMARY KEY (dataset_file, country_code, indicator_code, year)
);

CREATE TABLE IF NOT EXISTS carbon_monitor_variables (
  file_name TEXT NOT NULL REFERENCES dataset_files(file_name),
  variable_name TEXT NOT NULL,
  PRIMARY KEY (file_name, variable_name)
);

CREATE INDEX IF NOT EXISTS idx_world_bank_indicator_year
  ON world_bank_indicator_values (indicator_code, year);

CREATE INDEX IF NOT EXISTS idx_world_bank_country
  ON world_bank_indicator_values (country_code, year);

TRUNCATE TABLE carbon_monitor_variables, world_bank_indicator_values, dataset_files;
"""
    env_db = {**env, "PGUSER": "postgres", "PGPASSWORD": "postgres", "PGDATABASE": "pollution_solver"}
    sh([PSQL, "-v", "ON_ERROR_STOP=1", "-d", "pollution_solver", "-c", sql], env=env_db)

    csv_path, totals = build_world_bank_csv()

    nc_path = DATASETS_DIR / "CarbonMonitor_total_y2024_m12.nc"
    gz_path = DATASETS_DIR / "carbon-monitor-graced.gz"
    xml1 = DATASETS_DIR / XML_FILES[0]
    xml2 = DATASETS_DIR / XML_FILES[1]

    nc_sha = sha256_of_file(nc_path)
    gz_member_name = None
    gz_insert = ""
    if gz_path.exists():
        with tarfile.open(gz_path, "r:gz") as tf:
            members = tf.getmembers()
            if members:
                gz_member_name = members[0].name
        gz_insert = (
            f",\n  ('carbon-monitor-graced.gz', 'GZIP+TAR', {gz_path.stat().st_size}, NULL, "
            f"'tar.gz', '{gz_member_name}', NULL, 'Archive containing the same NetCDF payload')"
        )

    insert_dataset_files = f"""
INSERT INTO dataset_files (file_name, format, size_bytes, sha256, container_type, extracted_from, record_count, notes)
VALUES
  ('{XML_FILES[0]}', 'XML', {xml1.stat().st_size}, NULL, NULL, NULL, {totals[XML_FILES[0]]['rows']}, 'World Bank indicator EG.EGY.PRIM.PP.KD'),
  ('{XML_FILES[1]}', 'XML', {xml2.stat().st_size}, NULL, NULL, NULL, {totals[XML_FILES[1]]['rows']}, 'World Bank indicator EG.USE.PCAP.KG.OE'),
  ('CarbonMonitor_total_y2024_m12.nc', 'NetCDF4/HDF5', {nc_path.stat().st_size}, '{nc_sha}', NULL, NULL, NULL, 'Carbon Monitor gridded CO2 emissions'){gz_insert}
;

INSERT INTO carbon_monitor_variables (file_name, variable_name)
VALUES
  ('CarbonMonitor_total_y2024_m12.nc', 'latitude'),
  ('CarbonMonitor_total_y2024_m12.nc', 'longitude'),
  ('CarbonMonitor_total_y2024_m12.nc', 'emission'),
  ('CarbonMonitor_total_y2024_m12.nc', 'units'),
  ('CarbonMonitor_total_y2024_m12.nc', 'calendar'),
  ('CarbonMonitor_total_y2024_m12.nc', '_FillValue')
;
"""
    sh([PSQL, "-v", "ON_ERROR_STOP=1", "-d", "pollution_solver", "-c", insert_dataset_files], env=env_db)

    try:
        copy_cmd = r"\copy world_bank_indicator_values (dataset_file, country_code, country_name, indicator_code, indicator_name, year, value) FROM '{}' WITH (FORMAT csv)".format(
            str(csv_path)
        )
        sh([PSQL, "-v", "ON_ERROR_STOP=1", "-d", "pollution_solver", "-c", copy_cmd], env=env_db)
    finally:
        csv_path.unlink(missing_ok=True)

    return totals


def run_test_queries(env):
    env_db = {**env, "PGUSER": "postgres", "PGPASSWORD": "postgres", "PGDATABASE": "pollution_solver"}
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
            "top 10 latest energy-use values",
            """
SELECT country_code, country_name, year, ROUND(value::numeric, 3) AS value
FROM world_bank_indicator_values
WHERE indicator_code = 'EG.USE.PCAP.KG.OE'
  AND value IS NOT NULL
ORDER BY year DESC, value DESC
LIMIT 10;
""",
        ),
        (
            "carbon monitor metadata",
            """
SELECT df.file_name, df.format, df.size_bytes, df.sha256, array_agg(v.variable_name ORDER BY v.variable_name) AS variables
FROM dataset_files df
LEFT JOIN carbon_monitor_variables v ON v.file_name = df.file_name
WHERE df.file_name = 'CarbonMonitor_total_y2024_m12.nc'
GROUP BY df.file_name, df.format, df.size_bytes, df.sha256;
""",
        ),
    ]
    outputs = []
    for label, sql in queries:
        result = sh(
            [PSQL, "-v", "ON_ERROR_STOP=1", "-d", "pollution_solver", "-c", sql],
            env=env_db,
            capture_output=True,
        )
        outputs.append((label, result.stdout.strip()))
    return outputs


def main():
    ensure_required_binaries()
    env = get_pg_env()
    ensure_server_up(env)
    ensure_role_and_database(env)
    totals = ingest(env)
    outputs = run_test_queries(env)

    print("Ingestion complete.")
    for filename, stats in totals.items():
        print(f"- {filename}: rows={stats['rows']}, non_null_values={stats['non_null_values']}")
    print("")
    for label, output in outputs:
        print(f"--- {label} ---")
        print(output)
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
