import { useEffect, useState } from 'react';
import Globe from 'react-globe.gl';

function App() {
  const [pointsData, setPointsData] = useState([]);
  const [countries, setCountries] = useState([]);
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

  // Load pollution points from backend (Carbon Monitor points in Postgres)
  useEffect(() => {
    fetch(`${apiBaseUrl}/insights`)
      .then(res => res.json())
      .then(data => setPointsData(data.pollutionPoints || []));
  }, [apiBaseUrl]);

  // Load real country borders (GeoJSON)
  useEffect(() => {
    fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
      .then(res => res.json())
      .then(geojson => setCountries(geojson.features));
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <Globe
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"           // ← your high-res texture
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        
        // Points (your red pollution dots)
        pointsData={pointsData}
        pointLat={d => d.lat}
        pointLng={d => d.lng}
        pointColor={d => d.color || '#ff4444'}
        pointAltitude={d => d.size}
        pointRadius={0.18}
        pointLabel={d => `
          <b>Carbon hotspot</b><br/>
          Monthly emission: ${Number(d.monthlyEmission || 0).toFixed(3)}<br/>
          Max daily emission: ${Number(d.maxDailyEmission || 0).toFixed(3)}
        `}

        // === NEW: Country polygons + borders ===
        polygonsData={countries}
        polygonGeoJsonGeometry={d => d.geometry}
        polygonCapColor={() => 'rgba(255,255,255,0.1)'}   // semi-transparent fill
        polygonSideColor={() => 'rgba(255,255,255,0.3)'}  // sides
        polygonStrokeColor={() => '#ffffff'}              // white borders (visible!)
        polygonAltitude={0.01}                            // slight lift so borders pop
        polygonLabel={d => `<b>${d.properties.NAME}</b>`} // hover tooltip

        // === Interactivity ===
        onPolygonClick={polygon => {
          alert(`You clicked: ${polygon.properties.NAME}\n\nAdd your pollution insight here!`);
          // TODO: open a modal with real data for that country
        }}
        onPolygonHover={polygon => {
          // optional: highlight on hover
          console.log('Hovering:', polygon?.properties.NAME);
        }}
      />

      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        color: 'white',
        fontFamily: 'Arial',
        background: 'rgba(0,0,0,0.6)',
        padding: '15px',
        borderRadius: '8px',
        pointerEvents: 'none'
      }}>
        <h1>Pollution Solver 🌍</h1>
        <p>Carbon Monitor hotspots from Postgres • click countries for drilldown</p>
      </div>
    </div>
  );
}

export default App;
