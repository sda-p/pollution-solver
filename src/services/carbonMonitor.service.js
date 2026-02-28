import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_NETCDF_PATH = path.resolve(
  PROJECT_ROOT,
  "datasets/CarbonMonitor_total_y2024_m12.nc",
);
const EXTRACTOR_PATH = path.resolve(PROJECT_ROOT, "scripts/export_carbon_heatmap.py");

let cachedPayload = null;
let cacheKey = "";
let inflightPromise = null;

export async function fetchCarbonMonitorHeatmap(options = {}) {
  const stride =
    Number.isFinite(Number(options.stride)) && Number(options.stride) > 0
      ? Math.trunc(Number(options.stride))
      : 8;
  const percentile =
    Number.isFinite(Number(options.percentile)) && Number(options.percentile) > 0
      ? Number(options.percentile)
      : 99;
  const sourcePath = process.env.CARBON_MONITOR_FILE || DEFAULT_NETCDF_PATH;
  const nextKey = `${sourcePath}:${stride}:${percentile}`;
  if (cachedPayload && cacheKey === nextKey) return cachedPayload;
  if (inflightPromise && cacheKey === nextKey) return inflightPromise;

  cacheKey = nextKey;
  inflightPromise = execFileAsync(
    "python3",
    [
      EXTRACTOR_PATH,
      "--file",
      sourcePath,
      "--stride",
      String(stride),
      "--percentile",
      String(percentile),
    ],
    { maxBuffer: 20 * 1024 * 1024 },
  )
    .then(({ stdout }) => {
      const parsed = JSON.parse(stdout);
      cachedPayload = parsed;
      return parsed;
    })
    .finally(() => {
      inflightPromise = null;
    });

  return inflightPromise;
}
