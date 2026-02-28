import express from "express";
import cors from "cors";
import { fetchOsmElements } from "./services/osmClient.js";
import { resolveRoute } from "./services/graphhopperClient.js";
import { pool } from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/insights", async (_req, res) => {
  try {
    const query = `
WITH ranked AS (
  SELECT lat,
         lng,
         monthly_emission,
         max_daily_emission,
         MAX(monthly_emission) OVER () AS max_monthly
  FROM carbon_monitor_points
  WHERE monthly_emission > 0
  ORDER BY monthly_emission DESC
  LIMIT 5000
)
SELECT lat,
       lng,
       monthly_emission,
       max_daily_emission,
       CASE
         WHEN max_monthly IS NULL OR max_monthly = 0 THEN 0.05
         ELSE GREATEST(0.02, LEAST(0.5, monthly_emission / max_monthly))
       END AS size
FROM ranked
ORDER BY monthly_emission DESC;
`;

    const result = await pool.query(query);
    const pollutionPoints = result.rows.map((row) => {
      const size = Number(row.size);
      let color = "#66bb6a";
      if (size >= 0.33) color = "#ef5350";
      else if (size >= 0.12) color = "#ffb74d";

      return {
        lat: Number(row.lat),
        lng: Number(row.lng),
        size,
        color,
        monthlyEmission: Number(row.monthly_emission),
        maxDailyEmission: Number(row.max_daily_emission),
      };
    });

    res.json({ pollutionPoints });
  } catch (error) {
    res.status(500).json({
      error: "Failed to load pollution insights from database.",
      details: error.message,
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
