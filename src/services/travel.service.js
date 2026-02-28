const metricsData = require("../data/sustainabilityMetrics.json");
const { calculateMetrics } = require("../utils/calculator");

function getTravelMetrics(distance, modes) {
  const results = {};

  modes.forEach(mode => {
    const data = metricsData[mode];
    if (!data) throw new Error(`Mode "${mode}" not supported`);
    results[mode] = calculateMetrics(distance, data);
  });

  // Compare each mode vs car
  const carData = results["car"];
  if (carData) {
    Object.keys(results).forEach(mode => {
      if (mode !== "car") {
        results[mode].comparisonVsCar = {
          co2Saved: carData.co2_kg - results[mode].co2_kg,
          timeDifference: results[mode].time_hours - carData.time_hours
        };
      }
    });
  }

  return results;
}

module.exports = { getTravelMetrics };