import express from "express";
import cors from "cors";
import { fetchOsmElements } from "./services/osmClient.js";
import { resolveRoute } from "./services/graphhopperClient.js";
import { fetchPollutionInsights } from "./services/pollutionInsights.service.js";
import { fetchCarbonMonitorHeatmap } from "./services/carbonMonitor.service.js";

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

app.post("/routing/route", async (req, res) => {
  try {
    const { fromLat, fromLng, toLat, toLng, profile } = req.body || {};
    const nums = [fromLat, fromLng, toLat, toLng].map(Number);
    if (nums.some(Number.isNaN)) {
      res.status(400).json({
        error:
          "Invalid coordinates. Provide numeric fromLat, fromLng, toLat, toLng.",
      });
      return;
    }

    const route = await resolveRoute({
      fromLat: nums[0],
      fromLng: nums[1],
      toLat: nums[2],
      toLng: nums[3],
      profile,
    });
    res.json(route);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
});
