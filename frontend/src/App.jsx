import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import { API_BASE_URL, fetchOsmChunk } from './services/mobilityApi';

const ABERDEEN_OSM_TILE = {
  key: 'aberdeen:prerender:fine',
  lod: 'fine',
  south: 56.85,
  west: -2.62,
  north: 57.42,
  east: -1.72,
  lat: (56.85 + 57.42) / 2,
  lng: (-2.62 + -1.72) / 2,
  widthDeg: 0.9,
  heightDeg: 0.57
};
const OSM_ZOOM_ALTITUDE_THRESHOLD = 0.9;
const OSM_ABERDEEN_MAX_DISTANCE_DEG = 8;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const angularDistanceDeg = (lat1, lng1, lat2, lng2) => {
  const toRad = deg => (deg * Math.PI) / 180;
  const a1 = toRad(lat1);
  const b1 = toRad(lng1);
  const a2 = toRad(lat2);
  const b2 = toRad(lng2);
  const cosValue =
    Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(b2 - b1);
  return (Math.acos(clamp(cosValue, -1, 1)) * 180) / Math.PI;
};

const decodeRgbaTexture = image => {
  if (!image?.rgbaBase64 || !image?.width || !image?.height) return null;
  const raw = atob(image.rgbaBase64);
  const bytes = new Uint8ClampedArray(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);

  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(bytes, image.width, image.height), 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  texture.flipY = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
};


function App() {
  const globeRef = useRef();
  const carbonOverlayMaterialRef = useRef(null);
  const osmTileCacheRef = useRef(null);
  const osmTilePendingRef = useRef(null);
  const osmUpdateTimerRef = useRef(null);
  const osmRequestTokenRef = useRef(0);
  const [insights, setInsights] = useState([]);
  const [carbonBitmap, setCarbonBitmap] = useState(null);
  const [osmTiles, setOsmTiles] = useState([]);
  const [osmDebug, setOsmDebug] = useState({
    altitude: 2.5,
    lat: 0,
    lng: 0,
    requested: 0,
    visible: 0,
    cacheReady: false,
    fetchMs: 0,
    loading: false,
    failed: 0,
    error: '',
    active: false
  });
  const [countries, setCountries] = useState([]);
  const [countriesByIso3, setCountriesByIso3] = useState(new Map());

  const overlayOpacityFromAltitude = altitude => {
    const a = Number.isFinite(altitude) ? altitude : 2.5;
    const t = Math.max(0, Math.min(1, (a - 0.15) / 1.75));
    return 0.08 + 0.74 * t;
  };

  // Load country-level pollution insights from backend
  useEffect(() => {
    fetch(`${API_BASE_URL}/insights`)
      .then(res => res.json())
      .then(data => setInsights(data.pollutionPoints || []))
      .catch(() => setInsights([]));
  }, []);

  // Load CarbonMonitor rasterized emissions
  useEffect(() => {
    fetch(`${API_BASE_URL}/insights/carbon-monitor?stride=8&percentile=99.3`)
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
    const texture = decodeRgbaTexture(carbonBitmap);
    if (!texture) return [];
    return [{ texture, layerType: 'carbon-overlay' }];
  }, [carbonBitmap]);

  useEffect(() => {
    return () => {
      carbonOverlayData.forEach(layer => layer.texture?.dispose?.());
    };
  }, [carbonOverlayData]);

  useEffect(() => {
    return () => {
      if (osmUpdateTimerRef.current) clearTimeout(osmUpdateTimerRef.current);
      const tile = osmTileCacheRef.current;
      tile?.texture?.dispose?.();
      tile?.material?.dispose?.();
    };
  }, []);

  const shouldShowAberdeenOverlay = pov => {
    const altitude = Number.isFinite(pov?.altitude) ? pov.altitude : 2.5;
    if (altitude > OSM_ZOOM_ALTITUDE_THRESHOLD) return false;
    const lat = Number.isFinite(pov?.lat) ? pov.lat : 0;
    const lng = Number.isFinite(pov?.lng) ? pov.lng : 0;
    const distance = angularDistanceDeg(lat, lng, ABERDEEN_OSM_TILE.lat, ABERDEEN_OSM_TILE.lng);
    return distance <= OSM_ABERDEEN_MAX_DISTANCE_DEG;
  };

  const ensureAberdeenTileLoaded = async () => {
    if (osmTileCacheRef.current?.material && osmTileCacheRef.current?.texture) {
      return osmTileCacheRef.current;
    }
    if (osmTilePendingRef.current) return osmTilePendingRef.current;

    const promise = fetchOsmChunk({
      south: ABERDEEN_OSM_TILE.south,
      west: ABERDEEN_OSM_TILE.west,
      north: ABERDEEN_OSM_TILE.north,
      east: ABERDEEN_OSM_TILE.east,
      lod: ABERDEEN_OSM_TILE.lod,
      pixelSize: 4086
    }).then(payload => {
      const texture = decodeRgbaTexture(payload.image);
      if (!texture) throw new Error('Invalid OSM Aberdeen prerender image');
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.9,
        alphaTest: 0.02,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const tile = {
        ...ABERDEEN_OSM_TILE,
        layerType: 'osm-tile',
        texture,
        material
      };
      osmTileCacheRef.current = tile;
      return tile;
    });

    osmTilePendingRef.current = promise;
    try {
      return await promise;
    } finally {
      osmTilePendingRef.current = null;
    }
  };

  const updateOsmOverlayForPov = pov => {
    const token = osmRequestTokenRef.current + 1;
    osmRequestTokenRef.current = token;
    const altitude = Number.isFinite(pov?.altitude) ? pov.altitude : 2.5;
    const lat = Number.isFinite(pov?.lat) ? pov.lat : 0;
    const lng = Number.isFinite(pov?.lng) ? pov.lng : 0;
    const active = shouldShowAberdeenOverlay(pov);

    setOsmDebug(prev => ({
      ...prev,
      altitude,
      lat,
      lng,
      requested: active ? 1 : 0,
      visible: active && osmTileCacheRef.current ? 1 : 0,
      active,
      error: ''
    }));

    if (!active) {
      setOsmTiles([]);
      setOsmDebug(prev => ({
        ...prev,
        loading: false
      }));
      return;
    }

    const startedAt = performance.now();
    setOsmDebug(prev => ({ ...prev, loading: true }));
    ensureAberdeenTileLoaded()
      .then(tile => {
        if (token !== osmRequestTokenRef.current) return;
        setOsmTiles([tile]);
        setOsmDebug(prev => ({
          ...prev,
          visible: 1,
          cacheReady: true,
          fetchMs: Math.round(performance.now() - startedAt),
          loading: false,
          failed: 0
        }));
      })
      .catch(error => {
        if (token !== osmRequestTokenRef.current) return;
        setOsmTiles([]);
        setOsmDebug(prev => ({
          ...prev,
          visible: 0,
          fetchMs: Math.round(performance.now() - startedAt),
          loading: false,
          failed: 1,
          cacheReady: false,
          error: error?.message || 'unknown OSM chunk load error'
        }));
      });
  };

  useEffect(() => {
    const startedAt = performance.now();
    ensureAberdeenTileLoaded()
      .then(() => {
        setOsmDebug(prev => ({
          ...prev,
          cacheReady: true,
          fetchMs: Math.round(performance.now() - startedAt),
          failed: 0
        }));
      })
      .catch(error => {
        setOsmDebug(prev => ({
          ...prev,
          cacheReady: false,
          failed: 1,
          error: error?.message || 'failed to pre-render Aberdeen OSM tile'
        }));
      });
  }, []);

  const scheduleOsmOverlayUpdate = pov => {
    if (osmUpdateTimerRef.current) clearTimeout(osmUpdateTimerRef.current);
    osmUpdateTimerRef.current = setTimeout(() => {
      updateOsmOverlayForPov(pov);
    }, 160);
  };

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
          scheduleOsmOverlayUpdate(pov);
        }}
        onZoom={pov => {
          if (carbonOverlayMaterialRef.current) {
            carbonOverlayMaterialRef.current.opacity = overlayOpacityFromAltitude(pov?.altitude);
          }
          scheduleOsmOverlayUpdate(pov);
        }}
        pointerEventsFilter={(obj, data) => {
          void obj;
          if (data?.layerType === 'osm-tile') return false;
          if (data?.layerType === 'carbon-overlay') return false;
          return true;
        }}

        // OSM LoD chunk overlay
        tilesData={osmTiles}
        tileLat={tile => tile.lat}
        tileLng={tile => tile.lng}
        tileWidth={tile => tile.widthDeg}
        tileHeight={tile => tile.heightDeg}
        tileAltitude={() => 0.004}
        tileMaterial={tile => tile.material}
        tileCurvatureResolution={1}

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

      <div style={{
        position: 'absolute',
        top: 20,
        right: 20,
        color: '#d4f0ff',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: 1.45,
        background: 'rgba(6, 14, 24, 0.82)',
        border: '1px solid rgba(120, 180, 220, 0.35)',
        padding: '10px 12px',
        borderRadius: '8px',
        minWidth: '220px'
      }}>
        <div>OSM LoD Debug</div>
        <div>pov: {osmDebug.lat.toFixed(2)}, {osmDebug.lng.toFixed(2)}</div>
        <div>altitude: {osmDebug.altitude.toFixed(3)}</div>
        <div>overlay active: {osmDebug.active ? 'yes' : 'no'}</div>
        <div>requested chunks: {osmDebug.requested}</div>
        <div>visible chunks: {osmDebug.visible}</div>
        <div>cache ready: {osmDebug.cacheReady ? 'yes' : 'no'}</div>
        <div>last fetch: {osmDebug.fetchMs} ms</div>
        <div>failed requests: {osmDebug.failed}</div>
        <div>status: {osmDebug.loading ? 'loading' : 'idle'}</div>
        <div style={{ maxWidth: '340px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          error: {osmDebug.error || '-'}
        </div>
      </div>
    </div>
  );
}

export default App;
