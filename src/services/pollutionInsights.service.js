import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "pollution_solver",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
});

const DEFAULT_INDICATOR = "EG.USE.PCAP.KG.OE";

export async function fetchPollutionInsights({ limit = 220 } = {}) {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), 500)
    : 220;

  const sql = `
WITH latest_year AS (
  SELECT indicator_code, MAX(year) AS year
  FROM world_bank_indicator_values
  WHERE indicator_code = $1
    AND value IS NOT NULL
  GROUP BY indicator_code
)
SELECT
  wb.country_code,
  wb.country_name,
  wb.indicator_code,
  wb.indicator_name,
  wb.year,
  wb.value
FROM world_bank_indicator_values wb
JOIN latest_year ly
  ON ly.indicator_code = wb.indicator_code
 AND ly.year = wb.year
WHERE wb.indicator_code = $1
  AND wb.value IS NOT NULL
ORDER BY wb.value DESC
LIMIT $2
`;

  const result = await pool.query(sql, [DEFAULT_INDICATOR, safeLimit]);
  const values = result.rows.map((row) => Number(row.value)).filter(Number.isFinite);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;

  const pollutionPoints = result.rows.map((row) => {
    const value = Number(row.value);
    const normalized = maxValue > 0 ? value / maxValue : 0;
    return {
      countryCode: row.country_code,
      countryName: row.country_name,
      indicatorCode: row.indicator_code,
      indicatorName: row.indicator_name,
      year: row.year,
      value,
      normalized,
    };
  });

  return {
    pollutionPoints,
    meta: {
      indicatorCode: DEFAULT_INDICATOR,
      pointCount: pollutionPoints.length,
    },
  };
}

