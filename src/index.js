console.log("pollution-solver service started");
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// TODO: replace this with your real pollution data later
app.get('/insights', (req, res) => {
  const sampleData = [
    { lat: 40.71, lng: -74.00, size: 0.8, color: '#ff0000', name: 'New York' },
    { lat: 51.51, lng: -0.13, size: 0.6, color: '#ff0000', name: 'London' },
    { lat: 35.68, lng: 139.77, size: 0.9, color: '#ff0000', name: 'Tokyo' },
    // add more real data here soon
  ];
  res.json({ pollutionPoints: sampleData });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend API running on http://localhost:${PORT}`);
});
