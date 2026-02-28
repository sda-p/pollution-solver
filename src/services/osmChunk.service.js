import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const OVERPASS_URL =
  process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const OVERPASS_FALLBACK_URLS = (process.env.OVERPASS_FALLBACK_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const OVERPASS_ENDPOINTS = [OVERPASS_URL, ...OVERPASS_FALLBACK_URLS];
const OVERPASS_MIN_INTERVAL_MS = Math.max(
  250,
  Number(process.env.OVERPASS_MIN_INTERVAL_MS || 900),
);
const OVERPASS_MAX_RETRIES = Math.max(0, Number(process.env.OVERPASS_MAX_RETRIES || 2));

const LOD_CONFIG = {
  coarse: {
    highways: ["motorway", "trunk", "primary"],
    pixelSize: 128,
  },
  medium: {
    highways: ["motorway", "trunk", "primary", "secondary", "tertiary"],
    pixelSize: 128,
  },
  fine: {
    highways: [
      "motorway",
      "trunk",
      "primary",
      "secondary",
      "tertiary",
      "unclassified",
      "residential",
      "service",
      "living_street",
      "road",
    ],
    pixelSize: 128,
  },
};

const STYLE_BY_HIGHWAY = {
  motorway: { color: [255, 152, 69], width: 4 },
  trunk: { color: [255, 188, 96], width: 4 },
  primary: { color: [255, 219, 120], width: 3 },
  secondary: { color: [243, 243, 181], width: 2 },
  tertiary: { color: [212, 230, 212], width: 2 },
  unclassified: { color: [176, 196, 176], width: 1 },
  residential: { color: [164, 186, 201], width: 1 },
  service: { color: [152, 172, 189], width: 1 },
  living_street: { color: [165, 180, 202], width: 1 },
  road: { color: [155, 175, 194], width: 1 },
};

const NATURAL_FILL_STYLE = {
  wood: [66, 122, 78, 105],
  scrub: [102, 136, 92, 90],
  heath: [125, 118, 87, 85],
  grassland: [121, 142, 95, 80],
  wetland: [79, 126, 126, 100],
  water: [62, 108, 156, 120],
  beach: [175, 162, 116, 80],
  sand: [169, 156, 114, 80],
  bare_rock: [112, 112, 112, 75],
  default: [96, 128, 96, 70],
};

const LANDUSE_FILL_STYLE = {
  forest: [64, 118, 73, 105],
  farmland: [126, 141, 95, 85],
  meadow: [117, 142, 99, 80],
  grass: [108, 138, 96, 80],
  recreation_ground: [109, 143, 101, 85],
  residential: [120, 126, 132, 55],
  industrial: [128, 122, 116, 65],
  commercial: [134, 127, 122, 65],
  cemetery: [108, 133, 102, 80],
  default: [108, 130, 101, 65],
};

const chunkCache = new Map();
const CHUNK_TTL_MS = 10 * 60 * 1000;
const CHUNK_STALE_TTL_MS = 60 * 60 * 1000;
const CHUNK_DISK_TTL_MS = Math.max(
  CHUNK_STALE_TTL_MS,
  Number(process.env.OSM_CHUNK_DISK_TTL_MS || 30 * 24 * 60 * 60 * 1000),
);
const CHUNK_DISK_CACHE_DIR = process.env.OSM_CHUNK_CACHE_DIR
  ? path.resolve(process.env.OSM_CHUNK_CACHE_DIR)
  : path.resolve(process.cwd(), "cache", "osm-chunks");
const CHUNK_CACHE_SCHEMA_VERSION = 2;
const inflightByKey = new Map();
let overpassQueue = Promise.resolve();
let nextOverpassAllowedAt = 0;

function cachePathForKey(key) {
  const hash = createHash("sha1").update(key).digest("hex");
  return path.join(CHUNK_DISK_CACHE_DIR, `${hash}.json`);
}

async function readChunkFromDisk(key, now) {
  try {
    const file = cachePathForKey(key);
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const createdAt = Number(parsed.createdAt);
    const payload = parsed.payload;
    if (!Number.isFinite(createdAt) || !payload?.image?.rgbaBase64) return null;
    if (now - createdAt > CHUNK_DISK_TTL_MS) return null;
    return { createdAt, payload };
  } catch {
    return null;
  }
}

async function writeChunkToDisk(key, payload, createdAt) {
  try {
    await mkdir(CHUNK_DISK_CACHE_DIR, { recursive: true });
    const file = cachePathForKey(key);
    await writeFile(file, JSON.stringify({ createdAt, payload }), "utf8");
  } catch {
    // Best-effort disk cache: ignore write failures and continue serving live data.
  }
}

function buildRoadQuery({ south, west, north, east, highways }) {
  const regex = highways.join("|");
  return `
[out:json][timeout:25];
(
  way["highway"~"${regex}"](${south},${west},${north},${east});
  way["natural"](${south},${west},${north},${east});
  way["landuse"](${south},${west},${north},${east});
);
(._;>;);
out body;
`.trim();
}

function normalizeLongitude(lng) {
  let value = Number(lng);
  while (value < -180) value += 360;
  while (value > 180) value -= 360;
  return value;
}

function toPixel({ lat, lng, south, west, north, east, width, height }) {
  const lonSpan = east - west;
  const latSpan = north - south;
  if (lonSpan <= 0 || latSpan <= 0) return null;

  const x = ((lng - west) / lonSpan) * (width - 1);
  const y = ((north - lat) / latSpan) * (height - 1);
  return [x, y];
}

function blendPixel(buf, idx, r, g, b, a) {
  const srcA = Math.max(0, Math.min(255, a)) / 255;
  if (srcA <= 0) return;
  const dstA = buf[idx + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;

  const outR = (r * srcA + buf[idx] * dstA * (1 - srcA)) / outA;
  const outG = (g * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA;
  const outB = (b * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA;

  buf[idx] = Math.round(outR);
  buf[idx + 1] = Math.round(outG);
  buf[idx + 2] = Math.round(outB);
  buf[idx + 3] = Math.round(outA * 255);
}

function drawDisc(buf, width, height, cx, cy, radius, color) {
  const [r, g, b] = color;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(width - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(height - 1, Math.ceil(cy + radius));
  const radiusSq = radius * radius;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radiusSq) continue;
      const idx = (y * width + x) * 4;
      blendPixel(buf, idx, r, g, b, 215);
    }
  }
}

function drawSegment(buf, width, height, x0, y0, x1, y1, stroke, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps <= 0) {
    drawDisc(buf, width, height, x0, y0, Math.max(0.5, stroke / 2), color);
    return;
  }

  const radius = Math.max(0.5, stroke / 2);
  const stepX = dx / steps;
  const stepY = dy / steps;
  let px = x0;
  let py = y0;
  for (let i = 0; i <= steps; i += 1) {
    drawDisc(buf, width, height, px, py, radius, color);
    px += stepX;
    py += stepY;
  }
}

function drawFilledPolygon(buf, width, height, points, rgba) {
  if (!Array.isArray(points) || points.length < 3) return;
  const [r, g, b, a] = rgba;
  const ys = points.map((point) => point[1]);
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  if (maxY < minY) return;

  for (let y = minY; y <= maxY; y += 1) {
    const scanY = y + 0.5;
    const intersections = [];

    for (let i = 0; i < points.length; i += 1) {
      const p1 = points[i];
      const p2 = points[(i + 1) % points.length];
      const y1 = p1[1];
      const y2 = p2[1];
      if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY)) {
        const t = (scanY - y1) / (y2 - y1);
        intersections.push(p1[0] + t * (p2[0] - p1[0]));
      }
    }

    intersections.sort((left, right) => left - right);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const fromX = Math.max(0, Math.floor(intersections[i]));
      const toX = Math.min(width - 1, Math.ceil(intersections[i + 1]));
      for (let x = fromX; x <= toX; x += 1) {
        const idx = (y * width + x) * 4;
        blendPixel(buf, idx, r, g, b, a);
      }
    }
  }
}

function chooseStyle(highway, lod) {
  const style = STYLE_BY_HIGHWAY[highway] || STYLE_BY_HIGHWAY.road;
  if (lod === "coarse") return { ...style, width: Math.max(style.width, 2) };
  if (lod === "fine") return style;
  return { ...style, width: Math.max(style.width - 1, 1) };
}

function chooseLandFillStyle(tags) {
  if (tags?.natural) return NATURAL_FILL_STYLE[tags.natural] || NATURAL_FILL_STYLE.default;
  if (tags?.landuse) return LANDUSE_FILL_STYLE[tags.landuse] || LANDUSE_FILL_STYLE.default;
  return null;
}

function isClosedWay(wayNodes) {
  if (!Array.isArray(wayNodes) || wayNodes.length < 4) return false;
  const first = wayNodes[0];
  const last = wayNodes[wayNodes.length - 1];
  return first && last && first.lat === last.lat && first.lon === last.lon;
}

function renderRoadBitmap({ elements, south, west, north, east, width, height, lod }) {
  const nodes = new Map();
  const roadWays = [];
  const landWays = [];

  for (const element of elements) {
    if (element.type === "node") {
      nodes.set(element.id, { lat: element.lat, lon: normalizeLongitude(element.lon) });
      continue;
    }
    if (element.type === "way" && Array.isArray(element.nodes)) {
      if (element.tags?.highway) roadWays.push(element);
      if (element.tags?.natural || element.tags?.landuse) landWays.push(element);
    }
  }

  const buffer = new Uint8Array(width * height * 4);
  let drawnLandAreas = 0;
  let drawnWays = 0;

  for (const way of landWays) {
    const wayNodes = way.nodes.map((id) => nodes.get(id)).filter(Boolean);
    if (!isClosedWay(wayNodes)) continue;
    const fillStyle = chooseLandFillStyle(way.tags);
    if (!fillStyle) continue;

    const pixels = [];
    for (const node of wayNodes) {
      const point = toPixel({
        lat: node.lat,
        lng: node.lon,
        south,
        west,
        north,
        east,
        width,
        height,
      });
      if (!point) continue;
      pixels.push(point);
    }
    if (pixels.length < 3) continue;

    drawFilledPolygon(buffer, width, height, pixels, fillStyle);
    drawnLandAreas += 1;
  }

  for (const way of roadWays) {
    const highway = way.tags?.highway;
    const style = chooseStyle(highway, lod);
    const wayNodes = way.nodes
      .map((id) => nodes.get(id))
      .filter(Boolean);
    if (wayNodes.length < 2) continue;

    for (let i = 1; i < wayNodes.length; i += 1) {
      const from = wayNodes[i - 1];
      const to = wayNodes[i];
      const p0 = toPixel({
        lat: from.lat,
        lng: from.lon,
        south,
        west,
        north,
        east,
        width,
        height,
      });
      const p1 = toPixel({
        lat: to.lat,
        lng: to.lon,
        south,
        west,
        north,
        east,
        width,
        height,
      });
      if (!p0 || !p1) continue;
      drawSegment(
        buffer,
        width,
        height,
        p0[0],
        p0[1],
        p1[0],
        p1[1],
        style.width,
        style.color,
      );
    }

    drawnWays += 1;
  }

  return { buffer, drawnWays, drawnLandAreas };
}

export async function fetchOsmChunkBitmap({
  south,
  west,
  north,
  east,
  lod = "coarse",
  pixelSize,
}) {
  const config = LOD_CONFIG[lod] || LOD_CONFIG.coarse;
  const size = Number.isFinite(Number(pixelSize))
    ? Math.min(Math.max(Math.trunc(Number(pixelSize)), 64), 4086)
    : config.pixelSize;

  const key = `v${CHUNK_CACHE_SCHEMA_VERSION}:${lod}:${south.toFixed(4)}:${west.toFixed(
    4,
  )}:${north.toFixed(4)}:${east.toFixed(4)}:${size}`;
  const now = Date.now();
  const cached = chunkCache.get(key);
  if (cached && now - cached.createdAt < CHUNK_TTL_MS) {
    return {
      ...cached.payload,
      meta: {
        ...cached.payload.meta,
        source: "memory",
      },
    };
  }

  const diskCached = await readChunkFromDisk(key, now);
  if (diskCached) {
    chunkCache.set(key, diskCached);
    return {
      ...diskCached.payload,
      meta: {
        ...diskCached.payload.meta,
        source: "disk",
      },
    };
  }

  if (inflightByKey.has(key)) return inflightByKey.get(key);

  const task = (async () => {
    const query = buildRoadQuery({
      south,
      west,
      north,
      east,
      highways: config.highways,
    });

    try {
      const elements = await overpassRequestWithRetry(query);
      const { buffer, drawnWays, drawnLandAreas } = renderRoadBitmap({
        elements,
        south,
        west,
        north,
        east,
        width: size,
        height: size,
        lod,
      });

      const payload = {
        image: {
          width: size,
          height: size,
          rgbaBase64: Buffer.from(buffer).toString("base64"),
        },
        meta: {
          lod,
          south,
          west,
          north,
          east,
          highways: config.highways,
          wayCount: drawnWays,
          landAreaCount: drawnLandAreas,
          stale: false,
          source: "network",
        },
      };

      const createdAt = Date.now();
      chunkCache.set(key, { createdAt, payload });
      await writeChunkToDisk(key, payload, createdAt);
      return payload;
    } catch (error) {
      if (cached && now - cached.createdAt < CHUNK_STALE_TTL_MS) {
        return {
          ...cached.payload,
          meta: {
            ...cached.payload.meta,
            stale: true,
            staleAgeMs: now - cached.createdAt,
            source: "memory-stale",
          },
        };
      }
      throw error;
    }
  })().finally(() => {
    inflightByKey.delete(key);
  });

  inflightByKey.set(key, task);
  return task;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function parseRetryAfterMs(response) {
  const header = response.headers.get("retry-after");
  if (!header) return 0;
  const sec = Number(header);
  if (Number.isFinite(sec) && sec >= 0) return sec * 1000;
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return 0;
}

async function enqueueOverpassCall(call) {
  const run = async () => {
    const wait = nextOverpassAllowedAt - Date.now();
    if (wait > 0) await sleep(wait);
    const result = await call();
    nextOverpassAllowedAt = Date.now() + OVERPASS_MIN_INTERVAL_MS;
    return result;
  };

  const next = overpassQueue.then(run);
  overpassQueue = next.catch(() => {});
  return next;
}

async function overpassRequestWithRetry(query) {
  let lastError = null;
  for (let attempt = 0; attempt <= OVERPASS_MAX_RETRIES; attempt += 1) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const elements = await enqueueOverpassCall(async () => {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
            body: `data=${encodeURIComponent(query)}`,
          });

          if (response.status === 429) {
            const text = await response.text();
            const retryMs = parseRetryAfterMs(response);
            const rateErr = new Error(`Overpass chunk request failed (429): ${text}`);
            rateErr.retryMs = retryMs;
            throw rateErr;
          }

          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Overpass chunk request failed (${response.status}): ${text}`);
          }

          const json = await response.json();
          return json.elements || [];
        });

        return elements;
      } catch (error) {
        lastError = error;
        if (String(error?.message || "").includes("(429)")) {
          const jitter = Math.trunc(Math.random() * 300);
          const retryMs = Number(error.retryMs) > 0 ? Number(error.retryMs) : (attempt + 1) * 1200;
          await sleep(retryMs + jitter);
          continue;
        }
      }
    }
  }

  throw lastError || new Error("Overpass chunk request failed");
}
