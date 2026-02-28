import { useEffect, useState } from 'react';
import Globe from 'react-globe.gl';

function App() {
  const [pointsData, setPointsData] = useState([]);
  const [countries, setCountries] = useState([]);
  const [countryData, setCountryData] = useState({});

  // Load data from backend
  useEffect(() => {
    fetch('http://localhost:3001/insights')
      .then(res => res.json())
      .then(data => {
        setPointsData(data.pollutionPoints || []);
        setCountryData(data.countryData || {});
      });
  }, []);

  // Load country borders
  useEffect(() => {
    fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
      .then(res => res.json())
      .then(geojson => setCountries(geojson.features));
  }, []);

  // Color scale + perfect transparency for your Earth texture
const getCountryColor = (countryName) => {
  const data = countryData[countryName];
  if (!data) return 'rgba(100,100,100,0.25)'; // very subtle grey for no data

  const score = Math.min(data.pm25, 100);
  const hue = 120 - (score * 1.2); // green → yellow → red
  return `hsla(${hue}, 88%, 58%, 0.74)`;   // ← 0.74 opacity is the sweet spot
};

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <Globe
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
        backgroundImageUrl="/background-grid-10.png"

        // Pollution points
        pointsData={pointsData}
        pointLat={d => d.lat}
        pointLng={d => d.lng}
        pointColor={d => d.color || '#ff4444'}
        pointAltitude={d => d.size}
        pointRadius={0.5}

        // === COUNTRY COLORING + BORDERS ===
        polygonsData={countries}
        polygonGeoJsonGeometry={d => d.geometry}
        polygonCapColor={d => getCountryColor(d.properties.NAME)}
        polygonSideColor={() => 'rgba(255,255,255,0.4)'}
        polygonStrokeColor={() => '#ffffff'}
        polygonAltitude={0.012}

atmosphereColor="#a0d8ff"         // soft blue glow around the whole globe
atmosphereAltitude={0.15}
        
        // === RICH TOOLTIP ===
        polygonLabel={d => {
          const name = d.properties.NAME;
          const data = countryData[name] || { pm25: 'N/A', aqi: 'N/A', trend: '', description: 'No data' };
          return `
            <div style="background:rgba(0,0,0,0.85); color:white; padding:12px; border-radius:8px; min-width:200px;">
              <b style="font-size:18px;">${name}</b><br/>
              <span style="color:#0f0;">PM2.5: ${data.pm25} µg/m³</span><br/>
              <span style="color:#ff0;">AQI: ${data.aqi}</span><br/>
              Trend: ${data.trend}<br/>
              <i>${data.description}</i>
            </div>
          `;
        }}

        onPolygonClick={d => {
          const name = d.properties.NAME;
          const data = countryData[name];
          if (data) {
            alert(`${name}\nPM2.5: ${data.pm25} µg/m³\nAQI: ${data.aqi}\n${data.description}`);
          }
        }}
      />

      <div style={{
        position: 'absolute', top: 20, left: 20, color: 'white',
        background: 'rgba(0,0,0,0.7)', padding: '20px', borderRadius: '12px'
      }}>
        <h1>Pollution Solver 🌍</h1>
        <p>Countries colored by 2024 PM2.5 • Hover for details • Click for alert</p>
        <small>Red = bad • Green = clean</small>
      </div>
    </div>
  );
}

export default App;