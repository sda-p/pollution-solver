import express from "express";
import cors from "cors";
import { fetchOsmElements } from "./services/osmClient.js";
import { fetchPollutionInsights } from "./services/pollutionInsights.service.js";
import { fetchCarbonMonitorHeatmap } from "./services/carbonMonitor.service.js";
import { fetchOsmChunkBitmap } from "./services/osmChunk.service.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/insights", async (_req, res) => {
  try {
    const payload = await fetchPollutionInsights();
    res.json(payload);
  } catch (error) {
    console.error("Failed to load pollution insights:", error.message);
    res.status(503).json({
      error: "Unable to load pollution insights from database.",
      pollutionPoints: [],
    });
  }
});

app.get("/insights/carbon-monitor", async (req, res) => {
  try {
    const payload = await fetchCarbonMonitorHeatmap({
      stride: req.query.stride,
      percentile: req.query.percentile,
    });
    res.json(payload);
  } catch (error) {
    console.error("Failed to load CarbonMonitor heatmap:", error.message);
    res.status(503).json({
      error: "Unable to load CarbonMonitor heatmap data.",
      image: null,
    });
  }
});

app.post("/osm/features", async (req, res) => {
  try {
    const { south, west, north, east, amenity, highway } = req.body || {};
    const bbox = [south, west, north, east].map(Number);
    if (bbox.some(Number.isNaN)) {
      res.status(400).json({
        error:
          "Invalid bounding box. Provide numeric south, west, north, and east.",
      });
      return;
    }

    const elements = await fetchOsmElements({
      south: bbox[0],
      west: bbox[1],
      north: bbox[2],
      east: bbox[3],
      amenity,
      highway,
    });
    res.json({ count: elements.length, elements });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

app.get("/osm/chunk", async (req, res) => {
  try {
    const south = Number(req.query.south);
    const west = Number(req.query.west);
    const north = Number(req.query.north);
    const east = Number(req.query.east);
    const lod = typeof req.query.lod === "string" ? req.query.lod : "coarse";
    const pixelSize = Number(req.query.pixelSize);

    const bbox = [south, west, north, east];
    if (bbox.some(Number.isNaN)) {
      res.status(400).json({
        error: "Invalid bbox. Provide numeric south, west, north, east query params.",
      });
      return;
    }
    if (south >= north || west >= east) {
      res.status(400).json({
        error: "Invalid bbox bounds. Ensure south < north and west < east.",
      });
      return;
    }

    const payload = await fetchOsmChunkBitmap({
      south,
      west,
      north,
      east,
      lod,
      pixelSize: Number.isFinite(pixelSize) ? pixelSize : undefined,
    });
    res.json(payload);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
});
