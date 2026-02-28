import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';

function App() {
  const globeRef = useRef();
  const carbonOverlayMaterialRef = useRef(null);
  const [insights, setInsights] = useState([]);
  const [carbonBitmap, setCarbonBitmap] = useState(null);
  const [countries, setCountries] = useState([]);
  const [countriesByIso3, setCountriesByIso3] = useState(new Map());

  const overlayOpacityFromAltitude = altitude => {
    const a = Number.isFinite(altitude) ? altitude : 2.5;
    const t = Math.max(0, Math.min(1, (a - 0.15) / 1.75));
    return 0.08 + 0.74 * t;
  };

  // Load country-level pollution insights from backend
  useEffect(() => {
    fetch('http://localhost:3001/insights')
      .then(res => res.json())
      .then(data => setInsights(data.pollutionPoints || []))
      .catch(() => setInsights([]));
  }, []);

  // Load CarbonMonitor rasterized emissions
  useEffect(() => {
    fetch('http://localhost:3001/insights/carbon-monitor?stride=8&percentile=99.3')
      .then(res => res.json())
      .then(data => setCarbonBitmap(data.image || null))
      .catch(() => setCarbonBitmap(null));
  }, []);

  // Load real country borders (GeoJSON)
  useEffect(() => {
    fetch('https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson')
      .then(res => res.json())
      .then(geojson => {
        const features = geojson.features || [];
        setCountries(features);

        const byIso3 = new Map();
        features.forEach(feature => {
          const props = feature?.properties || {};
          [props.ISO_A3, props.ADM0_A3, props.BRK_A3, props.WB_A3].forEach(code => {
            if (typeof code === 'string' && code !== '-99' && !byIso3.has(code)) {
              byIso3.set(code, feature);
            }
          });
        });
        setCountriesByIso3(byIso3);
      })
      .catch(() => {
        setCountries([]);
        setCountriesByIso3(new Map());
      });
  }, []);

  const pointsData = useMemo(() => {
    if (!insights.length || !countriesByIso3.size) return [];

    const verticesFromGeometry = geometry => {
      if (!geometry) return [];
      if (geometry.type === 'Polygon') {
        return (geometry.coordinates?.[0] || []).filter(coord => coord.length >= 2);
      }
      if (geometry.type === 'MultiPolygon') {
        return (geometry.coordinates || []).flatMap(polygon =>
          (polygon?.[0] || []).filter(coord => coord.length >= 2)
        );
      }
      return [];
    };

    const centroidFromFeature = feature => {
      const coords = verticesFromGeometry(feature?.geometry);
      if (!coords.length) return null;

      const sums = coords.reduce(
        (acc, coord) => {
          acc.lng += Number(coord[0]) || 0;
          acc.lat += Number(coord[1]) || 0;
          return acc;
        },
        { lat: 0, lng: 0 }
      );

      return {
        lat: sums.lat / coords.length,
        lng: sums.lng / coords.length
      };
    };

    return insights
      .map(item => {
        const feature = countriesByIso3.get(item.countryCode);
        const centroid = feature ? centroidFromFeature(feature) : null;
        if (!centroid) return null;

        const intensity = Number.isFinite(item.normalized) ? item.normalized : 0;
        const red = Math.round(180 + intensity * 70);
        const green = Math.round(60 - intensity * 45);

        return {
          ...item,
          lat: centroid.lat,
          lng: centroid.lng,
          size: 0.1 + intensity * 0.65,
          color: `rgb(${red}, ${Math.max(green, 10)}, 30)`,
          name: item.countryName
        };
      })
      .filter(Boolean);
  }, [insights, countriesByIso3]);

  const carbonOverlayData = useMemo(() => {
    if (!carbonBitmap?.rgbaBase64 || !carbonBitmap?.width || !carbonBitmap?.height) return [];

    const raw = atob(carbonBitmap.rgbaBase64);
    const bytes = new Uint8ClampedArray(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);

    const canvas = document.createElement('canvas');
    canvas.width = carbonBitmap.width;
    canvas.height = carbonBitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];
    ctx.putImageData(new ImageData(bytes, carbonBitmap.width, carbonBitmap.height), 0, 0);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.flipY = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;

    return [{ texture }];
  }, [carbonBitmap]);

  useEffect(() => {
    return () => {
      carbonOverlayData.forEach(layer => layer.texture?.dispose?.());
    };
  }, [carbonOverlayData]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#000' }}>
      <Globe
        ref={globeRef}
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"           // ← your high-res texture
        backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
        
        // Points (your red pollution dots)
        pointsData={pointsData}
        pointLat={d => d.lat}
        pointLng={d => d.lng}
        pointColor={d => d.color || '#ff4444'}
        pointAltitude={d => d.size}
        pointRadius={0.24}
        pointLabel={d => `
          <b>${d.countryName}</b><br/>
          ${d.indicatorCode}: ${d.value?.toFixed?.(2) ?? d.value}<br/>
          Year: ${d.year}
        `}

        // CarbonMonitor pixel bitmap overlay
        customLayerData={carbonOverlayData}
        customThreeObject={layer => {
          const radius = (globeRef.current?.getGlobeRadius?.() || 100) * 1.0025;
          const geometry = new THREE.SphereGeometry(radius, 96, 96);
          const material = new THREE.MeshBasicMaterial({
            map: layer.texture,
            transparent: true,
            opacity: overlayOpacityFromAltitude(),
            depthWrite: false,
            side: THREE.DoubleSide
          });
          carbonOverlayMaterialRef.current = material;
          const mesh = new THREE.Mesh(geometry, material);
          mesh.rotation.y = -Math.PI / 2;
          return mesh;
        }}
        onGlobeReady={() => {
          const pov = globeRef.current?.pointOfView?.();
          if (carbonOverlayMaterialRef.current) {
            carbonOverlayMaterialRef.current.opacity = overlayOpacityFromAltitude(pov?.altitude);
          }
        }}
        onZoom={pov => {
          if (carbonOverlayMaterialRef.current) {
            carbonOverlayMaterialRef.current.opacity = overlayOpacityFromAltitude(pov?.altitude);
          }
        }}

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
          void polygon;
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
        <p>CarbonMonitor bitmap overlay + DB-backed country bars</p>
      </div>
    </div>
  );
}

export default App;
