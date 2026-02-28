const { getTravelMetrics } = require("../services/travel.service");

async function travelHandler(req, res) {
  try {
    const { distance, modes } = req.body;

    if (!distance || !Array.isArray(modes)) {
      return res.status(400).json({ error: "Distance and modes are required" });
    }

    const result = getTravelMetrics(distance, modes);
    res.json({ distance, result });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { travelHandler };