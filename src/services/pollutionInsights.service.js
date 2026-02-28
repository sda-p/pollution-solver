import { Pool } from "pg";
import { loadLocalEnv } from "../utils/loadEnv.js";

loadLocalEnv();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || "pollution_solver",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
});

const DEFAULT_INDICATOR = "EG.USE.PCAP.KG.OE";
const SECONDARY_INDICATOR = "EG.EGY.PRIM.PP.KD";
const SUPPORTED_INDICATORS = [DEFAULT_INDICATOR, SECONDARY_INDICATOR];

export async function fetchPollutionInsights({ limit = 220 } = {}) {
  const safeLimit = Number.isFinite(limit)
    ? Math.min(Math.max(Math.trunc(limit), 1), 500)
    : 220;

  const sql = `
WITH latest_year AS (
  SELECT indicator_code, MAX(year) AS year
  FROM world_bank_indicator_values
  WHERE indicator_code = ANY($1::text[])
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
WHERE wb.indicator_code = ANY($1::text[])
  AND wb.value IS NOT NULL
ORDER BY wb.country_name, wb.indicator_code
`;

  const result = await pool.query(sql, [SUPPORTED_INDICATORS]);
  const energyRows = result.rows
    .filter((row) => row.indicator_code === DEFAULT_INDICATOR)
    .sort((a, b) => Number(b.value) - Number(a.value));
  const limitedEnergyRows = energyRows.slice(0, safeLimit);

  const values = limitedEnergyRows
    .map((row) => Number(row.value))
    .filter(Number.isFinite);
  const maxValue = values.length > 0 ? Math.max(...values) : 0;

  const pollutionPoints = limitedEnergyRows.map((row) => {
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

  const countryData = {};
  result.rows.forEach((row) => {
    const countryName = row.country_name;
    if (!countryData[countryName]) {
      countryData[countryName] = {
        countryCode: row.country_code,
      };
    }

    const value = Number(row.value);
    if (!Number.isFinite(value)) return;

    if (row.indicator_code === DEFAULT_INDICATOR) {
      countryData[countryName].energyUsePerCapitaKgOe = value;
      countryData[countryName].energyUseYear = row.year;
      countryData[countryName].energyUseIndicatorCode = row.indicator_code;
      countryData[countryName].energyUseIndicatorName = row.indicator_name;
    } else if (row.indicator_code === SECONDARY_INDICATOR) {
      countryData[countryName].primaryEnergyPerPppKd = value;
      countryData[countryName].primaryEnergyYear = row.year;
      countryData[countryName].primaryEnergyIndicatorCode = row.indicator_code;
      countryData[countryName].primaryEnergyIndicatorName = row.indicator_name;
    }
  });

  const energyUseValues = Object.values(countryData)
    .map((row) => row.energyUsePerCapitaKgOe)
    .filter(Number.isFinite);
  const productivityValues = Object.values(countryData)
    .map((row) => row.primaryEnergyPerPppKd)
    .filter(Number.isFinite);
  const maxEnergyUse = energyUseValues.length ? Math.max(...energyUseValues) : null;
  const maxProductivity = productivityValues.length ? Math.max(...productivityValues) : null;

  Object.values(countryData).forEach((row) => {
    const energyUse = row.energyUsePerCapitaKgOe;
    const productivity = row.primaryEnergyPerPppKd;
    const normalizedEnergyUse =
      Number.isFinite(energyUse) && Number.isFinite(maxEnergyUse) && maxEnergyUse > 0
        ? energyUse / maxEnergyUse
        : null;
    const normalizedProductivity =
      Number.isFinite(productivity) && Number.isFinite(maxProductivity) && maxProductivity > 0
        ? productivity / maxProductivity
        : null;

    row.normalizedEnergyUse = normalizedEnergyUse;
    row.normalizedPrimaryEnergy = normalizedProductivity;
    row.carbIntensityScore =
      Number.isFinite(normalizedEnergyUse) && Number.isFinite(normalizedProductivity)
        ? Math.round((normalizedEnergyUse * (1 - normalizedProductivity)) * 100)
        : null;
  });

  return {
    pollutionPoints,
    countryData,
    meta: {
      indicatorCode: DEFAULT_INDICATOR,
      secondaryIndicatorCode: SECONDARY_INDICATOR,
      pointCount: pollutionPoints.length,
    },
  };
}
