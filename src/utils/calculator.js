function calculateMetrics(distance, transportData) {
  const co2_kg = Number((distance * transportData.avg_co2_per_km).toFixed(2));
  const time_hours = Number((distance / transportData.avg_speed_kmh).toFixed(2));
  const calories = Math.round(distance * transportData.calories_per_km);

  return { co2_kg, time_hours, calories };
}

module.exports = { calculateMetrics };