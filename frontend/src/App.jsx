import { useEffect, useState } from 'react';
import Globe from 'react-globe.gl';

function App() {
  const [pointsData, setPointsData] = useState([]);
  const [countries, setCountries] = useState([]);
  const [countryData, setCountryData] = useState({});
  const [selectedCountry, setSelectedCountry] = useState(null);

  // Load data
  useEffect(() => {
    fetch('http://localhost:3001/insights')
      .then(res => res.json())
      .then(data => {
        setPointsData(data.pollutionPoints || []);
        setCountryData(data.countryData || {});
      });
  }, []);

  useEffect(() => {
    fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
      .then(res => res.json())
      .then(geojson => setCountries(geojson.features));
  }, []);

  const getCountryColor = (countryName) => {
    const data = countryData[countryName];
    if (!data) return 'rgba(100,100,100,0.25)';
    const score = Math.min(data.pm25, 100);
    const hue = 120 - (score * 1.2);
    return `hsla(${hue}, 88%, 58%, 0.74)`;
  };

  return (
    <div className="h-screen bg-emerald-950 text-white flex flex-col overflow-hidden">
      {/* Glass Header */}
{/* Sustainable Glass Header */}
<div className="fixed top-0 left-0 right-0 z-50 navbar bg-emerald-950/80 backdrop-blur-3xl border-b border-emerald-400/30 px-8 py-6">
  <div className="navbar-start">
    <div className="flex items-center gap-4">
      <span className="text-4xl">🌍</span>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pollution Solver</h1>
        <p className="text-xs text-emerald-400/90 -mt-1">see • choose • improve</p>
      </div>
    </div>
  </div>

  <div className="navbar-center hidden md:flex gap-2">
    <a href="#" className="btn btn-ghost btn-lg text-white hover:text-emerald-400">Home</a>
    <a href="#" className="btn btn-ghost btn-lg text-white hover:text-emerald-400">Plan Trip</a>
    <a href="#" className="btn btn-ghost btn-lg text-white hover:text-emerald-400">My Trips</a>
    <a href="#" className="btn btn-ghost btn-lg text-white hover:text-emerald-400">Help</a>
  </div>

  <div className="navbar-end flex gap-3">
    <a href="#" className="btn btn-ghost btn-lg text-emerald-400 hover:text-emerald-300">Data Sources</a>
    <a href="#" className="btn btn-ghost btn-lg text-emerald-400 hover:text-emerald-300">About</a>
  </div>
</div>

      {/* Globe - full width */}
            <div className="flex-1 pt-24 relative overflow-hidden">
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

          onPolygonClick={d => {
            const name = d.properties.NAME;
            setSelectedCountry(name);
          }}
        />
      </div>

            {/* === SIMPLE LEFT DRAWER - sustainable green + smooth slide === */}
      <div 
        className={`fixed top-24 left-0 h-[calc(100vh-6rem)] w-96 bg-emerald-950 border-r border-emerald-600 shadow-2xl z-50 overflow-y-auto transition-transform duration-300 ease-out ${
          selectedCountry ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-8">
          {/* Close button */}
          <button 
            onClick={() => setSelectedCountry(null)}
            className="btn btn-ghost btn-circle absolute top-6 right-6 text-white"
          >
            ✕
          </button>

          <div className="mt-6">
            <h2 className="text-4xl font-bold text-emerald-100 mb-1">{selectedCountry}</h2>
            <p className="text-emerald-400">2024 Sustainability Snapshot</p>
          </div>

          {countryData[selectedCountry] ? (
            <div className="mt-12 space-y-10">
              <div className="space-y-6">
                <div>
                  <div className="text-emerald-300 text-sm">PM2.5 Level</div>
                  <div className="text-6xl font-bold text-red-400 mt-1">
                    {countryData[selectedCountry].pm25}
                  </div>
                  <div className="text-xs text-emerald-400">µg/m³</div>
                </div>

                <div>
                  <div className="text-emerald-300 text-sm">Air Quality Index</div>
                  <div className="text-6xl font-bold text-orange-400 mt-1">
                    {countryData[selectedCountry].aqi}
                  </div>
                </div>
              </div>

              <div className="p-6 bg-emerald-900/60 rounded-2xl text-emerald-100 leading-relaxed">
                {countryData[selectedCountry].description}
              </div>

              <button 
                onClick={() => {
                  alert(`Planning journey from ${selectedCountry}...`);
                  setSelectedCountry(null);
                }}
                className="btn btn-success btn-lg w-full text-xl"
              >
                Start a Journey from here 🌱
              </button>
            </div>
          ) : (
            <p className="mt-12 text-emerald-400">No detailed data yet for this country.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;