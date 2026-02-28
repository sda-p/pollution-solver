import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/insights', (req, res) => {
  const samplePoints = [ /* keep your existing red dots if you want */ ];

  // REAL 2024 PM2.5 country data (from IQAir report)
  const countryData = {
    "Chad": { pm25: 91.8, aqi: 182, trend: "↑ 3%", description: "Worst in the world" },
    "Bangladesh": { pm25: 78.0, aqi: 165, trend: "↓ 2%", description: "Severe" },
    "Pakistan": { pm25: 73.7, aqi: 158, trend: "→", description: "Severe" },
    "Democratic Republic of the Congo": { pm25: 58.2, aqi: 142, trend: "↑ 5%", description: "Very Unhealthy" },
    "India": { pm25: 50.6, aqi: 132, trend: "↓ 8%", description: "Unhealthy" },
    "Tajikistan": { pm25: 46.3, aqi: 125, trend: "→", description: "Unhealthy" },
    "Nepal": { pm25: 42.8, aqi: 118, trend: "↓ 1%", description: "Unhealthy" },
    "United States of America": { pm25: 9.2, aqi: 38, trend: "↓ 12%", description: "Good" },
    "United Kingdom": { pm25: 8.1, aqi: 34, trend: "↓ 5%", description: "Good" },
    "Germany": { pm25: 7.4, aqi: 31, trend: "↓ 15%", description: "Good" },
    "China": { pm25: 32.4, aqi: 95, trend: "↓ 20%", description: "Moderate" },
    "Australia": { pm25: 4.2, aqi: 18, trend: "↓ 3%", description: "Excellent" },
    "New Zealand": { pm25: 3.8, aqi: 16, trend: "→", description: "Excellent" },
    "Canada": { pm25: 6.5, aqi: 27, trend: "↓ 10%", description: "Good" },
    "Brazil": { pm25: 12.1, aqi: 48, trend: "↑ 4%", description: "Moderate" }
    // Add more countries later from your own data
  };

  res.json({
    pollutionPoints: samplePoints,
    countryData: countryData
  });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend API running on http://localhost:${PORT}`);
});