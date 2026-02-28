import { useEffect, useState } from 'react';
import Globe from 'react-globe.gl';

function App() {
  const [pointsData, setPointsData] = useState([]);
  const [countries, setCountries] = useState([]);
  const [countryData, setCountryData] = useState({});

  // Journey planner state
  const [fromCity, setFromCity] = useState("London");
  const [toCity, setToCity] = useState("New York");
  const [mode, setMode] = useState("plane");
  const [results, setResults] = useState(null);

  const cities = ["London", "New York", "Tokyo", "Delhi", "Sydney", "São Paulo", "Cairo", "Beijing"];

  // Load data from backend
  useEffect(() => {
    fetch('http://localhost:3001/insights')
      .then(res => res.json())
      .then(data => {
        setPointsData(data.pollutionPoints || []);
        setCountryData(data.countryData || {});
      })
      .catch(err => console.error("Backend not running?", err));
  }, []);

  // Load country borders
  useEffect(() => {
    fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
      .then(res => res.json())
      .then(geojson => setCountries(geojson.features));
  }, []);

  // Country color with nice transparency
  const getCountryColor = (countryName) => {
    const data = countryData[countryName];
    if (!data) return 'rgba(100,100,100,0.25)';

    const score = Math.min(data.pm25, 100);
    const hue = 120 - (score * 1.2);
    return `hsla(${hue}, 88%, 58%, 0.74)`;
  };

  // Calculate journey impact
  const calculateImpact = () => {
    const baseCO2 = 950;
    const multipliers = { plane: 1, train: 0.18, car: 0.45, bike: 0.01 };
    const timeHours = { plane: 8, train: 32, car: 14, bike: 999 };
    const exerciseCal = { plane: 50, train: 200, car: 80, bike: 1800 };

    const carbon = Math.round(baseCO2 * multipliers[mode]);
    const time = timeHours[mode];
    const cal = exerciseCal[mode];

    setResults({
      carbon,
      time,
      cal,
      mode,
      from: fromCity,
      to: toCity,
      recommendation: mode === "train" 
        ? "Best for the planet! Saves 82% CO₂" 
        : mode === "bike" 
        ? "Zero carbon but only for short trips" 
        : "Fast but high impact — consider train next time"
    });
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Nice Header */}
      {/* === TOP  WITH BUTTONS === */}
{/* === REAL GLASS HEADER - globe clearly shows through === */}
<div className="fixed top-0 left-0 right-0 z-50 navbar bg-black/10 backdrop-blur-3xl border-b border-white/10 px-8 py-6">
  <div className="navbar-start">
    <div className="flex items-center gap-4">
      <span className="text-4xl">🌍</span>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pollution Solver</h1>
        <p className="text-xs text-green-400/80 -mt-1">see • choose • improve</p>
      </div>
    </div>
  </div>

  <div className="navbar-center hidden md:flex gap-2">
    <a href="#" className="btn btn-ghost btn-lg text-white hover:text-green-400">Home</a>
    <a href="#" className="btn btn-ghost btn-lg text-white hover:text-green-400">Plan Trip</a>
    <a href="#" className="btn btn-ghost btn-lg text-white hover:text-green-400">My Trips</a>
    <a href="#" className="btn btn-ghost btn-lg text-white hover:text-green-400">Help</a>
  </div>

  <div className="navbar-end flex gap-3">
    <a href="#" className="btn btn-ghost btn-lg text-green-400 hover:text-green-300">Data Sources</a>
    <a href="#" className="btn btn-ghost btn-lg text-green-400 hover:text-green-300">About</a>
  </div>
</div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden pt-24">
        {/* Globe */}
        <div className="flex-1 relative">
          <Globe
            globeImageUrl="//unpkg.com/three-globe/example/img/earth-day.jpg"
            bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
            backgroundImageUrl="/background-grid-10.png"
            showAtmosphere={true}
            atmosphereColor="#a0d8ff"
            atmosphereAltitude={0.25}

            pointsData={pointsData}
            pointLat={d => d.lat}
            pointLng={d => d.lng}
            pointColor="#ff4444"
            pointAltitude={d => d.size || 0.6}
            pointRadius={0.5}

            polygonsData={countries}
            polygonGeoJsonGeometry={d => d.geometry}
            polygonCapColor={d => getCountryColor(d.properties.NAME)}
            polygonSideColor={() => 'rgba(255,255,255,0.4)'}
            polygonStrokeColor={() => '#ffffff'}
            polygonAltitude={0.012}

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
          />
        </div>

        {/* Sidebar */}
        <div className="w-96 bg-base-900 border-l border-green-500/30 p-8 flex flex-col gap-6 overflow-y-auto">
          <h2 className="text-2xl font-bold">Plan Your Journey</h2>

          <div>
            <label className="block text-sm mb-2">From</label>
            <select 
              value={fromCity} 
              onChange={e => setFromCity(e.target.value)}
              className="select select-bordered w-full bg-base-800"
            >
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-2">To</label>
            <select 
              value={toCity} 
              onChange={e => setToCity(e.target.value)}
              className="select select-bordered w-full bg-base-800"
            >
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-3">Travel Mode</label>
            <div className="grid grid-cols-2 gap-3">
              {['plane', 'train', 'car', 'bike'].map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`btn ${mode === m ? 'btn-success' : 'btn-outline btn-neutral'} flex items-center gap-2`}
                >
                  {m === 'plane' && '✈️'} 
                  {m === 'train' && '🚄'} 
                  {m === 'car' && '🚗'} 
                  {m === 'bike' && '🚲'} 
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <button 
            onClick={calculateImpact}
            className="btn btn-success btn-lg mt-4 text-lg font-bold"
          >
            Calculate Impact 🌱
          </button>

          {results && (
            <div className="card bg-base-800 shadow-xl mt-4">
              <div className="card-body">
                <h3 className="card-title">
                  {results.from} → {results.to} ({results.mode})
                </h3>
                <div className="space-y-3 text-lg">
                  <p><span className="text-red-400">Carbon:</span> {results.carbon} kg CO₂</p>
                  <p><span className="text-blue-400">Time:</span> ~{results.time} hours</p>
                  <p><span className="text-yellow-400">Exercise:</span> ~{results.cal} calories</p>
                </div>
                <div className="mt-4 p-4 bg-green-900/50 rounded-xl text-green-300 font-medium">
                  {results.recommendation}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;