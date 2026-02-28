import { useEffect, useState } from 'react';
import Globe from 'react-globe.gl';
import SidebarWidget from './layout/SidebarWidget.jsx';

function App() {
  const [pointsData, setPointsData] = useState([]);
  const [countries, setCountries] = useState([]);
  const [countryData, setCountryData] = useState({});
  const [selectedCountry, setSelectedCountry] = useState(null);

  // Load pollution & country data
  useEffect(() => {
    fetch('http://localhost:3001/insights')
      .then(res => res.json())
      .then(data => {
        setPointsData(data.pollutionPoints || []);
        setCountryData(data.countryData || {});
      })
      .catch(err => console.error("Backend not running, using empty data"));
  }, []);

  useEffect(() => {
    fetch(
      'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson'
    )
      .then(res => res.json())
      .then(geojson => setCountries(geojson.features));
  }, []);

  const getCountryColor = countryName => {
    const data = countryData[countryName];
    if (!data) return 'rgba(100,100,100,0.25)';
    const score = Math.min(data.pm25, 100);
    const hue = 120 - score * 1.2;
    return `hsla(${hue}, 88%, 58%, 0.74)`;
  };

  return (
    <div className="h-screen bg-emerald-950 text-white flex flex-col overflow-hidden font-sans">
      {/* Glass Header */}
      <div className="fixed top-0 left-0 right-0 z-50 navbar bg-emerald-950/80 backdrop-blur-3xl border-b border-emerald-400/30 px-8 py-6">
        <div className="navbar-start flex items-center gap-4">
          <span className="text-4xl">🌍</span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-emerald-50">Pollution Solver</h1>
            <p className="text-xs text-emerald-400/90 -mt-1 uppercase tracking-widest">see • choose • improve</p>
          </div>
        </div>
      </div>

      {/* Globe Container */}
      <div className="flex-1 pt-24 relative overflow-hidden">
        <Globe
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-day.jpg"
          bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
          backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
          showAtmosphere={true}
          atmosphereColor="#a0d8ff"
          atmosphereAltitude={0.25}
          pointsData={pointsData}
          pointLat={d => d.lat}
          pointLng={d => d.lng}
          pointColor={() => "#ff4444"}
          pointAltitude={0.1}
          pointRadius={0.5}
          polygonsData={countries}
          polygonGeoJsonGeometry={d => d.geometry}
          polygonCapColor={d => getCountryColor(d.properties.NAME)}
          polygonSideColor={() => 'rgba(255,255,255,0.4)'}
          polygonStrokeColor={() => '#ffffff'}
          polygonAltitude={0.012}
          onPolygonClick={d => setSelectedCountry(d.properties.NAME)}
        />
      </div>

      {/* Left Sidebar Drawer */}
      <div
        className={`fixed top-24 left-0 h-[calc(100vh-6rem)] w-[400px] bg-emerald-950/95 backdrop-blur-md border-r border-emerald-500/30 shadow-2xl z-50 overflow-y-auto transition-transform duration-500 ease-in-out ${
          selectedCountry ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="p-8">
          <button
            onClick={() => setSelectedCountry(null)}
            className="absolute top-6 right-6 p-2 rounded-full hover:bg-emerald-800/50 transition-colors text-emerald-400"
          >
            ✕
          </button>

          {selectedCountry && (
            <div className="animate-in fade-in slide-in-from-left-4 duration-500">
              <h2 className="text-4xl font-bold text-emerald-50 mb-1">{selectedCountry}</h2>
              <p className="text-emerald-400/80 mb-6 text-sm font-medium">Regional Mobility Analysis</p>

              {countryData[selectedCountry] ? (
                <div className="space-y-6 mb-8">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-emerald-900/30 rounded-2xl border border-emerald-800/50">
                      <div className="text-emerald-400 text-xs uppercase font-bold tracking-tighter">PM2.5 Level</div>
                      <div className="text-4xl font-bold text-red-400 mt-1">{countryData[selectedCountry].pm25}</div>
                    </div>
                    <div className="p-4 bg-emerald-900/30 rounded-2xl border border-emerald-800/50">
                      <div className="text-emerald-400 text-xs uppercase font-bold tracking-tighter">AQI Index</div>
                      <div className="text-4xl font-bold text-orange-400 mt-1">{countryData[selectedCountry].aqi}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-emerald-900/20 rounded-xl mb-8 border border-emerald-800/30 text-emerald-400/60 italic text-sm">
                  Basic data loaded. Select a major hub for detailed transport metrics.
                </div>
              )}

              {/* Pass the selected country to the widget */}
              <SidebarWidget location={selectedCountry} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;