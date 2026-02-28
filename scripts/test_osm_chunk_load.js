#!/usr/bin/env node
import { fetchOsmChunkBitmap } from "../src/services/osmChunk.service.js";

function parseArgs(argv) {
  const args = {
    mode: "api",
    baseUrl: "http://localhost:3001",
    centerLat: 56.11,
    centerLng: -2.93,
    tileSize: 6,
    grid: 1,
    lod: "medium",
    concurrency: 2,
    pixelSize: 96,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === "--mode" && next) args.mode = next;
    if (token === "--base-url" && next) args.baseUrl = next;
    if (token === "--lat" && next) args.centerLat = Number(next);
    if (token === "--lng" && next) args.centerLng = Number(next);
    if (token === "--tile-size" && next) args.tileSize = Number(next);
    if (token === "--grid" && next) args.grid = Number(next);
    if (token === "--lod" && next) args.lod = next;
    if (token === "--concurrency" && next) args.concurrency = Number(next);
    if (token === "--pixel-size" && next) args.pixelSize = Number(next);
  }

  args.grid = Math.max(0, Math.trunc(args.grid));
  args.concurrency = Math.max(1, Math.trunc(args.concurrency));
  return args;
}

function wrapLng(lng) {
  let value = Number(lng);
  while (value < -180) value += 360;
  while (value >= 180) value -= 360;
  return value;
}

function makeBboxes({ centerLat, centerLng, tileSize, grid }) {
  const list = [];
  for (let y = -grid; y <= grid; y += 1) {
    for (let x = -grid; x <= grid; x += 1) {
      const south = Math.max(-90, centerLat + y * tileSize - tileSize / 2);
      const north = Math.min(90, south + tileSize);
      const west = wrapLng(centerLng + x * tileSize - tileSize / 2);
      const east = west + tileSize;
      list.push({ south, west, north, east, x, y });
    }
  }
  return list;
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (error) {
        results[idx] = {
          idx,
          req: items[idx],
          ok: false,
          status: 599,
          elapsedMs: 0,
          bodyText: String(error?.message || error),
          bodyJson: null,
        };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function requestViaApi(baseUrl, req) {
  const url = new URL("/osm/chunk", baseUrl);
  url.searchParams.set("south", String(req.south));
  url.searchParams.set("west", String(req.west));
  url.searchParams.set("north", String(req.north));
  url.searchParams.set("east", String(req.east));
  url.searchParams.set("lod", req.lod);
  url.searchParams.set("pixelSize", String(req.pixelSize));

  const started = Date.now();
  const response = await fetch(url);
  const elapsedMs = Date.now() - started;
  const bodyText = await response.text();

  let bodyJson = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = null;
  }

  return {
    ok: response.ok,
    status: response.status,
    elapsedMs,
    bodyText,
    bodyJson,
  };
}

async function requestDirect(req) {
  const started = Date.now();
  try {
    const bodyJson = await fetchOsmChunkBitmap(req);
    return {
      ok: true,
      status: 200,
      elapsedMs: Date.now() - started,
      bodyText: "",
      bodyJson,
    };
  } catch (error) {
    return {
      ok: false,
      status: 599,
      elapsedMs: Date.now() - started,
      bodyText: String(error?.message || error),
      bodyJson: null,
    };
  }
}

function summarize(results) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const wayCounts = ok.map((r) => Number(r.bodyJson?.meta?.wayCount || 0));
  const staleCount = ok.filter((r) => Boolean(r.bodyJson?.meta?.stale)).length;
  const emptyTiles = wayCounts.filter((v) => v === 0).length;
  const avgLatency = results.length
    ? Math.round(results.reduce((acc, r) => acc + r.elapsedMs, 0) / results.length)
    : 0;
  const topErrors = new Map();
  failed.forEach((r) => {
    const key = (r.bodyJson?.error || r.bodyText || `status-${r.status}`).slice(0, 220);
    topErrors.set(key, (topErrors.get(key) || 0) + 1);
  });

  return {
    total: results.length,
    ok: ok.length,
    failed: failed.length,
    avgLatencyMs: avgLatency,
    wayCountSum: wayCounts.reduce((a, b) => a + b, 0),
    wayCountAvg: wayCounts.length
      ? Number((wayCounts.reduce((a, b) => a + b, 0) / wayCounts.length).toFixed(2))
      : 0,
    emptyTiles,
    staleCount,
    topErrors: Array.from(topErrors.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([message, count]) => ({ count, message })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bboxes = makeBboxes(args).map((bbox) => ({
    ...bbox,
    lod: args.lod,
    pixelSize: args.pixelSize,
  }));

  console.log(
    `Running OSM chunk load test: mode=${args.mode}, requests=${bboxes.length}, lod=${args.lod}, concurrency=${args.concurrency}`,
  );

  const results = await mapWithConcurrency(bboxes, args.concurrency, async (req, idx) => {
    const result =
      args.mode === "direct"
        ? await requestDirect(req)
        : await requestViaApi(args.baseUrl, req);
    return { ...result, req, idx };
  });

  const summary = summarize(results);
  console.log("\nSummary:");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\nSample responses:");
  results.slice(0, 8).forEach((item) => {
    const req = item.req || {};
    const meta = item.bodyJson?.meta;
    console.log(
      JSON.stringify(
        {
          idx: item.idx,
          status: item.status,
          ok: item.ok,
          elapsedMs: item.elapsedMs,
          bbox: {
            south: Number.isFinite(req.south) ? Number(req.south.toFixed(2)) : null,
            west: Number.isFinite(req.west) ? Number(req.west.toFixed(2)) : null,
            north: Number.isFinite(req.north) ? Number(req.north.toFixed(2)) : null,
            east: Number.isFinite(req.east) ? Number(req.east.toFixed(2)) : null,
          },
          wayCount: meta?.wayCount ?? null,
          stale: meta?.stale ?? null,
          error: item.bodyJson?.error || (!item.ok ? item.bodyText.slice(0, 120) : null),
        },
        null,
        0,
      ),
    );
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
