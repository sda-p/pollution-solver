import express from "express";
import cors from "cors";
import { fetchOsmElements } from "./services/osmClient.js";
import { resolveRoute } from "./services/graphhopperClient.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// TODO: replace this with real pollution + OSM-derived insights.
app.get("/insights", (_req, res) => {
  const sampleData = [
    { lat: 40.71, lng: -74.0, size: 0.8, color: "#ff0000", name: "New York" },
    { lat: 51.51, lng: -0.13, size: 0.6, color: "#ff0000", name: "London" },
    { lat: 35.68, lng: 139.77, size: 0.9, color: "#ff0000", name: "Tokyo" },
  ];
  res.json({ pollutionPoints: sampleData });
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
