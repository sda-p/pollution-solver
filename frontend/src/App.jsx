import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import SidebarWidget from './layout/SidebarWidget.jsx';
import * as THREE from 'three';
import { API_BASE_URL, fetchOsmChunk, fetchOsmReverse, searchOsmAddress, fetchRoute } from './services/mobilityApi';

const ABERDEEN_BOUNDS = {
  south: 56.85,
  west: -2.62,
  north: 57.42,
  east: -1.72
};
const ABERDEEN_CENTER = {
  lat: (ABERDEEN_BOUNDS.south + ABERDEEN_BOUNDS.north) / 2,
  lng: (ABERDEEN_BOUNDS.west + ABERDEEN_BOUNDS.east) / 2
};
const OSM_ZOOM_ALTITUDE_THRESHOLD = 1.8;
const OSM_LOD_LEVELS = [
  { lod: 'coarse', maxRefineAltitude: 1.25, pixelSize: 1536 },
  { lod: 'medium', maxRefineAltitude: 1.12, pixelSize: 1536 },
  { lod: 'fine', maxRefineAltitude: 0.68, pixelSize: 2048 }
];
const NEXT_LEVEL_CENTER_TRIGGER_FACTOR = 1.15;
const TOP_CHUNK_WIDTH_DEG = ABERDEEN_BOUNDS.east - ABERDEEN_BOUNDS.west;
const TOP_CHUNK_HEIGHT_DEG = ABERDEEN_BOUNDS.north - ABERDEEN_BOUNDS.south;
const OSM_ABERDEEN_MAX_DISTANCE_DEG = 14;
const MIN_CAMERA_ALTITUDE = 0.002;
const ZOOM_DAMPING_START_ALTITUDE = 0.22;

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

const chunkCenterDistanceDeg = (lat, lng, chunk) =>
  angularDistanceDeg(lat, lng, (chunk.south + chunk.north) / 2, (chunk.west + chunk.east) / 2);

const subdivideChunk = chunk => {
  const midLat = (chunk.south + chunk.north) / 2;
  const midLng = (chunk.west + chunk.east) / 2;
  return [
    { south: chunk.south, west: chunk.west, north: midLat, east: midLng, suffix: 'sw' },
    { south: chunk.south, west: midLng, north: midLat, east: chunk.east, suffix: 'se' },
    { south: midLat, west: chunk.west, north: chunk.north, east: midLng, suffix: 'nw' },
    { south: midLat, west: midLng, north: chunk.north, east: chunk.east, suffix: 'ne' }
  ];
};

const mapWithConcurrency = async (items, limit, worker) => {
  const concurrency = Math.max(1, Math.trunc(limit));
  const results = new Array(items.length);
  let cursor = 0;

  const run = async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      try {
        results[idx] = await worker(items[idx], idx);
      } catch (error) {
        results[idx] = { __error: error };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
};

const parseTopChunkKey = key => {
  const [x, y] = String(key || '').split(':').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
};

const topChunkBounds = ({ x, y }) => {
  const west = ABERDEEN_BOUNDS.west + x * TOP_CHUNK_WIDTH_DEG;
  const east = west + TOP_CHUNK_WIDTH_DEG;
  const south = ABERDEEN_BOUNDS.south + y * TOP_CHUNK_HEIGHT_DEG;
  const north = south + TOP_CHUNK_HEIGHT_DEG;
  if (west < -180 || east > 180 || south < -90 || north > 90) return null;
  return { west, east, south, north };
};

const buildChunkSpecsFromTopChunks = (topChunkKeys, pov) => {
  const lat = Number.isFinite(pov?.lat) ? pov.lat : ABERDEEN_CENTER.lat;
  const lng = Number.isFinite(pov?.lng) ? pov.lng : ABERDEEN_CENTER.lng;
  const altitude = Number.isFinite(pov?.altitude) ? pov.altitude : 2.5;
  const specs = [];

  const visit = (chunk, depth, pathPrefix, topKey) => {
    const level = OSM_LOD_LEVELS[depth];
    const widthDeg = chunk.east - chunk.west;
    const heightDeg = chunk.north - chunk.south;
    const withMeta = {
      ...chunk,
      path: pathPrefix,
      lod: level.lod,
      pixelSize: level.pixelSize,
      widthDeg,
      heightDeg,
      lat: (chunk.south + chunk.north) / 2,
      lng: (chunk.west + chunk.east) / 2
    };

    const hasChildLevel = depth < OSM_LOD_LEVELS.length - 1;
    const childChunks = hasChildLevel ? subdivideChunk(chunk) : [];
    const childHalfDiagonalDeg = hasChildLevel
      ? Math.sqrt(
          ((childChunks[0].north - childChunks[0].south) / 2) ** 2 +
            ((childChunks[0].east - childChunks[0].west) / 2) ** 2
        )
      : 0;
    const nearestChildCenterDeg = hasChildLevel
      ? Math.min(...childChunks.map(child => chunkCenterDistanceDeg(lat, lng, child)))
      : Number.POSITIVE_INFINITY;
    const shouldRefine =
      hasChildLevel &&
      altitude <= level.maxRefineAltitude &&
      nearestChildCenterDeg <= childHalfDiagonalDeg * NEXT_LEVEL_CENTER_TRIGGER_FACTOR;

    if (!shouldRefine) {
      specs.push({
        ...withMeta,
        key: `${withMeta.lod}:${topKey}:${pathPrefix}`
      });
      return;
    }

    childChunks.forEach(child => {
      visit(child, depth + 1, `${pathPrefix}.${child.suffix}`, topKey);
    });
  };

  topChunkKeys.forEach(topKey => {
    const parsed = parseTopChunkKey(topKey);
    if (!parsed) return;
    const bounds = topChunkBounds(parsed);
    if (!bounds) return;
    visit(bounds, 0, 'root', topKey);
  });

  return specs;
};

function App() {
  const globeRef = useRef();
  const carbonOverlayMaterialRef = useRef(null);
  const osmTileCacheRef = useRef(new Map());
  const osmTilePendingRef = useRef(new Map());
  const osmUpdateTimerRef = useRef(null);
  const osmRequestTokenRef = useRef(0);
  const [insights, setInsights] = useState([]);
  const [carbonBitmap, setCarbonBitmap] = useState(null);
  const [cameraAltitude, setCameraAltitude] = useState(2.5);
  const [osmTiles, setOsmTiles] = useState([]);
  const [osmDebug, setOsmDebug] = useState({
    altitude: 2.5,
    lat: 0,
    lng: 0,
    requested: 0,
    visible: 0,
    coarse: 0,
    medium: 0,
    fine: 0,
    cacheReady: false,
    cacheSize: 0,
    fetchMs: 0,
    loading: false,
    failed: 0,
    error: '',
    active: false
  });
  const [osmLookup, setOsmLookup] = useState({
    loading: false,
    lat: null,
    lng: null,
    addressLine: '',
    displayName: '',
    locality: '',
    country: '',
    error: ''
  });
  const [addressSearch, setAddressSearch] = useState({
    q: '',
    loading: false,
    options: [],
    selectedIdx: -1,
    error: ''
  });
  const searchTokenRef = useRef(0);
  const [clickMarker, setClickMarker] = useState(null);
  const [selectedAddressMarker, setSelectedAddressMarker] = useState(null);
  const [routeState, setRouteState] = useState({
    start: null,
    end: null,
    path: null,
    loading: false,
    error: '',
    distanceMeters: 0,
    durationSeconds: 0
  });
  const [countries, setCountries] = useState([]);
  const [countryData, setCountryData] = useState({});
  const [selectedCountry, setSelectedCountry] = useState(null);

  // Load pollution & country data
  const [countriesByIso3, setCountriesByIso3] = useState(new Map());

  const overlayOpacityFromAltitude = altitude => {
    const a = Number.isFinite(altitude) ? altitude : 2.5;
    const t = Math.max(0, Math.min(1, (a - 0.15) / 1.75));
    return 0.08 + 0.74 * t;
  };

  const borderOpacityFromAltitude = altitude => {
    const a = Number.isFinite(altitude) ? altitude : 2.5;
    const t = Math.max(0, Math.min(1, (a - 0.15) / 1.75));
    return 0.05 + 0.6 * t;
  };

  const polygonAltitudeFromCamera = altitude => {
    const a = Number.isFinite(altitude) ? altitude : 2.5;
    const t = Math.max(0, Math.min(1, (a - 0.15) / 1.75));
    return 0.0002 + 0.0018 * t;
  };

  const applyLogZoomDamping = pov => {
    const globe = globeRef.current;
    const controls = globe?.controls?.();
    if (!controls || !globe) return Number.isFinite(pov?.altitude) ? pov.altitude : cameraAltitude;

    const radius = globe.getGlobeRadius?.() || 100;
    controls.minDistance = radius * (1 + MIN_CAMERA_ALTITUDE);

    const altitude = Number.isFinite(pov?.altitude) ? pov.altitude : cameraAltitude;
    const clampedAltitude = Math.max(MIN_CAMERA_ALTITUDE, altitude);

    const span = Math.max(0.00001, ZOOM_DAMPING_START_ALTITUDE - MIN_CAMERA_ALTITUDE);
    const normalized = clamp((clampedAltitude - MIN_CAMERA_ALTITUDE) / span, 0, 1);
    const logScaled = Math.log10(1 + 9 * normalized); // 0..1 logarithmic curve
    controls.zoomSpeed = 0.004 + 0.52 * logScaled;

    if (altitude < MIN_CAMERA_ALTITUDE) {
      const currentPov = globe.pointOfView?.() || {};
      globe.pointOfView({ ...currentPov, altitude: MIN_CAMERA_ALTITUDE }, 0);
    }

    return clampedAltitude;
  };

  const updateCameraAltitudeFromPov = pov => {
    if (Number.isFinite(pov?.altitude)) {
      setCameraAltitude(pov.altitude);
      return pov.altitude;
    }
    return cameraAltitude;
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
      .then(data => {
        setPointsData(data.pollutionPoints || []);
        setCountryData(data.countryData || {});
      })
      .catch(err => console.error("Backend not running, using empty data"));
      .then(data => setCarbonBitmap(data.image || null))
      .catch(() => setCarbonBitmap(null));
  }, []);

  useEffect(() => {
    fetch(
      'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson'
    )
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
    const cache = osmTileCacheRef.current;
    const pending = osmTilePendingRef.current;
    return () => {
      if (osmUpdateTimerRef.current) clearTimeout(osmUpdateTimerRef.current);
      cache.forEach(tile => {
        tile?.texture?.dispose?.();
        tile?.material?.dispose?.();
      });
      pending.clear();
    };
  }, []);

  const shouldShowAberdeenOverlay = pov => {
    const altitude = Number.isFinite(pov?.altitude) ? pov.altitude : 2.5;
    if (altitude > OSM_ZOOM_ALTITUDE_THRESHOLD) return false;
    const lat = Number.isFinite(pov?.lat) ? pov.lat : 0;
    const lng = Number.isFinite(pov?.lng) ? pov.lng : 0;
    const distance = angularDistanceDeg(lat, lng, ABERDEEN_CENTER.lat, ABERDEEN_CENTER.lng);
    return distance <= OSM_ABERDEEN_MAX_DISTANCE_DEG;
  };

  const ensureChunkLoaded = async spec => {
    const cached = osmTileCacheRef.current.get(spec.key);
    if (cached?.material && cached?.texture) return cached;

    if (osmTilePendingRef.current.has(spec.key)) {
      return osmTilePendingRef.current.get(spec.key);
    }

    const promise = fetchOsmChunk({
      south: spec.south,
      west: spec.west,
      north: spec.north,
      east: spec.east,
      lod: spec.lod,
      pixelSize: spec.pixelSize
    }).then(payload => {
      const texture = decodeRgbaTexture(payload.image);
      if (!texture) throw new Error(`Invalid OSM chunk image: ${spec.key}`);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.9,
        alphaTest: 0.02,
        depthWrite: false,
        side: THREE.DoubleSide
      });
      const tile = {
        ...spec,
        layerType: 'osm-tile',
        texture,
        material
      };
      osmTileCacheRef.current.set(spec.key, tile);
      return tile;
    }).finally(() => {
      osmTilePendingRef.current.delete(spec.key);
    });

    osmTilePendingRef.current.set(spec.key, promise);
    return promise;
  };

  const updateOsmOverlayForPov = pov => {
    const token = osmRequestTokenRef.current + 1;
    osmRequestTokenRef.current = token;
    const altitude = Number.isFinite(pov?.altitude) ? pov.altitude : 2.5;
    const lat = Number.isFinite(pov?.lat) ? pov.lat : 0;
    const lng = Number.isFinite(pov?.lng) ? pov.lng : 0;
    const active = shouldShowAberdeenOverlay(pov);
    const specs = active
      ? buildChunkSpecsFromTopChunks(['0:0'], pov)
      : [];

    setOsmDebug(prev => ({
      ...prev,
      altitude,
      lat,
      lng,
      requested: specs.length,
      visible: 0,
      active,
      error: ''
    }));

    if (!active) {
      setOsmTiles([]);
      setOsmDebug(prev => ({
        ...prev,
        requested: 0,
        visible: 0,
        coarse: 0,
        medium: 0,
        fine: 0,
        loading: false
      }));
      return;
    }

    const startedAt = performance.now();
    setOsmDebug(prev => ({ ...prev, loading: true }));
    mapWithConcurrency(specs, 4, spec => ensureChunkLoaded(spec))
      .then(results => {
        if (token !== osmRequestTokenRef.current) return;
        const failedErrors = results.filter(item => item?.__error).map(item => item.__error);
        const visibleTiles = results.filter(item => item && !item.__error);
        const byLod = visibleTiles.reduce(
          (acc, tile) => {
            if (tile?.lod === 'coarse') acc.coarse += 1;
            else if (tile?.lod === 'medium') acc.medium += 1;
            else if (tile?.lod === 'fine') acc.fine += 1;
            return acc;
          },
          { coarse: 0, medium: 0, fine: 0 }
        );
        setOsmTiles(visibleTiles);
        setOsmDebug(prev => ({
          ...prev,
          visible: visibleTiles.length,
          coarse: byLod.coarse,
          medium: byLod.medium,
          fine: byLod.fine,
          cacheReady: osmTileCacheRef.current.size > 0,
          cacheSize: osmTileCacheRef.current.size,
          fetchMs: Math.round(performance.now() - startedAt),
          loading: false,
          failed: failedErrors.length,
          error: failedErrors[0]?.message || ''
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
          failed: specs.length || 1,
          cacheReady: osmTileCacheRef.current.size > 0,
          cacheSize: osmTileCacheRef.current.size,
          error: error?.message || 'unknown OSM chunk load error'
        }));
      });
  };

  useEffect(() => {
    const startedAt = performance.now();
    const initialSpec = {
      ...ABERDEEN_BOUNDS,
      lod: 'coarse',
      pixelSize: OSM_LOD_LEVELS[0].pixelSize,
      widthDeg: TOP_CHUNK_WIDTH_DEG,
      heightDeg: TOP_CHUNK_HEIGHT_DEG,
      lat: ABERDEEN_CENTER.lat,
      lng: ABERDEEN_CENTER.lng,
      key: 'coarse:0:0:root',
      path: 'root'
    };

    ensureChunkLoaded(initialSpec)
      .then(() => {
        setOsmDebug(prev => ({
          ...prev,
          cacheReady: true,
          cacheSize: osmTileCacheRef.current.size,
          fetchMs: Math.round(performance.now() - startedAt),
          failed: 0
        }));
      })
      .catch(error => {
        setOsmDebug(prev => ({
          ...prev,
          cacheReady: osmTileCacheRef.current.size > 0,
          cacheSize: osmTileCacheRef.current.size,
          failed: 1,
          error: error?.message || 'failed to pre-render Aberdeen OSM tile'
        }));
      });
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
  const scheduleOsmOverlayUpdate = pov => {
    if (osmUpdateTimerRef.current) clearTimeout(osmUpdateTimerRef.current);
    osmUpdateTimerRef.current = setTimeout(() => {
      updateOsmOverlayForPov(pov);
    }, 160);
  };

  const resolveNearestRoad = async (coords, options = {}) => {
    const lat = Number(coords?.lat);
    const lng = Number(coords?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const fromClick = Boolean(options.fromClick);

    if (fromClick) {
      setClickMarker({
        id: `click:${lat.toFixed(5)}:${lng.toFixed(5)}`,
        lat,
        lng,
        color: '#2f9dff',
        dotRadius: 0.0005,
        altitude: 0.0003001
      });
    }

    setOsmLookup({
      loading: true,
      lat,
      lng,
      addressLine: '',
      displayName: '',
      locality: '',
      country: '',
      error: ''
    });

    try {
      const data = await fetchOsmReverse({ lat, lng });
      setOsmLookup({
        loading: false,
        lat,
        lng,
        addressLine: data?.addressLine || data?.road || '',
        displayName: data?.displayName || '',
        locality: data?.locality || '',
        country: data?.country || '',
        error: ''
      });
    } catch (error) {
      setOsmLookup({
        loading: false,
        lat,
        lng,
        addressLine: '',
        displayName: '',
        locality: '',
        country: '',
        error: error?.message || 'reverse geocoding failed'
      });
    }
  };

  useEffect(() => {
    const q = addressSearch.q.trim();
    if (q.length < 3) {
      setAddressSearch(prev => ({
        ...prev,
        loading: false,
        options: [],
        selectedIdx: -1,
        error: ''
      }));
      return;
    }

    const token = searchTokenRef.current + 1;
    searchTokenRef.current = token;
    const timer = setTimeout(async () => {
      try {
        setAddressSearch(prev => ({ ...prev, loading: true, error: '' }));
        const pov = globeRef.current?.pointOfView?.() || {};
        const payload = await searchOsmAddress({
          q,
          limit: 7,
          aroundLat: Number.isFinite(pov?.lat) ? pov.lat : undefined,
          aroundLng: Number.isFinite(pov?.lng) ? pov.lng : undefined
        });
        if (token !== searchTokenRef.current) return;
        const options = Array.isArray(payload?.results) ? payload.results : [];
        setAddressSearch(prev => ({
          ...prev,
          loading: false,
          options,
          selectedIdx: options.length ? 0 : -1,
          error: ''
        }));
      } catch (error) {
        if (token !== searchTokenRef.current) return;
        setAddressSearch(prev => ({
          ...prev,
          loading: false,
          options: [],
          selectedIdx: -1,
          error: error?.message || 'address search failed'
        }));
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [addressSearch.q]);

  const goToSearchSelection = () => {
    const idx = addressSearch.selectedIdx;
    const option =
      idx >= 0 && idx < addressSearch.options.length
        ? addressSearch.options[idx]
        : addressSearch.options[0];
    if (!option) return;

    const lat = Number(option.lat);
    const lng = Number(option.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    setSelectedAddressMarker({
      id: `${option.osmType || 'osm'}:${option.osmId || 'x'}:${lat.toFixed(5)}:${lng.toFixed(5)}`,
      lat,
      lng,
      title: option.displayName || 'Selected location',
      color: '#3de56d',
      dotRadius: 0.0005,
      altitude: 0.0003001
    });

    globeRef.current?.pointOfView?.({ lat, lng, altitude: 0.04 }, 1200);
    resolveNearestRoad({ lat, lng });
  };

  const requestRoute = async (start, end) => {
    setRouteState(prev => ({
      ...prev,
      start,
      end,
      path: prev.path,
      loading: true,
      error: ''
    }));
    try {
      const payload = await fetchRoute({
        startLat: start.lat,
        startLng: start.lng,
        endLat: end.lat,
        endLng: end.lng
      });
      const points = Array.isArray(payload?.points) ? payload.points : [];
      const coords = points
        .map(pair => {
          const lat = Number(pair?.[0]);
          const lng = Number(pair?.[1]);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return { lat, lng };
        })
        .filter(Boolean);
      if (coords.length < 2) throw new Error('Route geometry was empty.');
      setRouteState({
        start,
        end,
        path: { id: `route:${Date.now()}`, coords },
        loading: false,
        error: '',
        distanceMeters: Number(payload?.distanceMeters) || 0,
        durationSeconds: Number(payload?.durationSeconds) || 0
      });
    } catch (error) {
      setRouteState(prev => ({
        ...prev,
        loading: false,
        error: error?.message || 'route request failed'
      }));
    }
  };

  const addRoutePointFromClick = coords => {
    const lat = Number(coords?.lat);
    const lng = Number(coords?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const point = { lat, lng };
    setRouteState(prev => {
      if (!prev.start || (prev.start && prev.end)) {
        return {
          ...prev,
          start: point,
          end: null,
          path: null,
          error: ''
        };
      }
      return {
        ...prev,
        end: point,
        error: ''
      };
    });
  };

  useEffect(() => {
    if (!routeState.start || !routeState.end) return;
    requestRoute(routeState.start, routeState.end);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState.start?.lat, routeState.start?.lng, routeState.end?.lat, routeState.end?.lng]);

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
        labelsData={[clickMarker, selectedAddressMarker].filter(Boolean)}
        labelLat={d => d.lat}
        labelLng={d => d.lng}
        labelText={() => ''}
        labelColor={d => d.color}
        labelSize={0.0001}
        labelDotRadius={d => d.dotRadius || 0.0001}
        labelAltitude={d => d.altitude || 0.0003001}
        pathsData={routeState.path ? [routeState.path] : []}
        pathPoints={d => d.coords}
        pathPointLat={p => p.lat}
        pathPointLng={p => p.lng}
        pathPointAlt={() => 0.0003002}
        pathColor={() => '#00ffd0'}
        pathStroke={3.55}
        pathTransitionDuration={0}

        // CarbonMonitor pixel bitmap overlay
        customLayerData={carbonOverlayData}
        customThreeObject={layer => {
          const radius = (globeRef.current?.getGlobeRadius?.() || 100) * 1.0008;
          const geometry = new THREE.SphereGeometry(radius, 96, 96);
          const material = new THREE.MeshBasicMaterial({
            map: layer.texture,
            transparent: true,
            opacity: overlayOpacityFromAltitude(cameraAltitude),
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
          const dampedAltitude = applyLogZoomDamping(pov);
          const altitude = updateCameraAltitudeFromPov({ ...pov, altitude: dampedAltitude });
          if (carbonOverlayMaterialRef.current) {
            carbonOverlayMaterialRef.current.opacity = overlayOpacityFromAltitude(altitude);
          }
          scheduleOsmOverlayUpdate(pov);
        }}
        onZoom={pov => {
          const dampedAltitude = applyLogZoomDamping(pov);
          const altitude = updateCameraAltitudeFromPov({ ...pov, altitude: dampedAltitude });
          if (carbonOverlayMaterialRef.current) {
            carbonOverlayMaterialRef.current.opacity = overlayOpacityFromAltitude(altitude);
          }
          scheduleOsmOverlayUpdate(pov);
        }}
        onGlobeClick={() => {}}
        pointerEventsFilter={(obj, data) => {
          void obj;
          if (data?.layerType === 'osm-tile') return true;
          if (data?.layerType === 'carbon-overlay') return false;
          // Keep polygon meshes from hijacking tile clicks; use onTileClick coords instead.
          if (data?.geometry && data?.properties) return false;
          return true;
        }}

        // OSM LoD chunk overlay
        tilesData={osmTiles}
        tileLat={tile => tile.lat}
        tileLng={tile => tile.lng}
        tileWidth={tile => tile.widthDeg}
        tileHeight={tile => tile.heightDeg}
        tileAltitude={() => 0.0003}
        tileMaterial={tile => tile.material}
        tilesTransitionDuration={0}
        tileTransitionDuration={0}
        tileCurvatureResolution={1}
        onTileClick={(tile, event, coords) => {
          void tile;
          void event;
          addRoutePointFromClick(coords);
          resolveNearestRoad(coords, { fromClick: true });
        }}

        // === NEW: Country polygons + borders ===
        polygonsData={countries}
        polygonGeoJsonGeometry={d => d.geometry}
        polygonCapColor={() => `rgba(255,255,255,${(borderOpacityFromAltitude(cameraAltitude) * 0.25).toFixed(3)})`}
        polygonSideColor={() => `rgba(255,255,255,${(borderOpacityFromAltitude(cameraAltitude) * 0.45).toFixed(3)})`}
        polygonStrokeColor={() => `rgba(255,255,255,${borderOpacityFromAltitude(cameraAltitude).toFixed(3)})`}
        polygonAltitude={polygonAltitudeFromCamera(cameraAltitude)}
        polygonLabel={d => `<b>${d.properties.NAME}</b>`} // hover tooltip

        // === Interactivity ===
        onPolygonClick={() => {}}
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
        <div>lod coarse/med/fine: {osmDebug.coarse}/{osmDebug.medium}/{osmDebug.fine}</div>
        <div>cache ready: {osmDebug.cacheReady ? 'yes' : 'no'}</div>
        <div>cache size: {osmDebug.cacheSize}</div>
        <div>last fetch: {osmDebug.fetchMs} ms</div>
        <div>failed requests: {osmDebug.failed}</div>
        <div>status: {osmDebug.loading ? 'loading' : 'idle'}</div>
        <div style={{ maxWidth: '340px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          error: {osmDebug.error || '-'}
        </div>
        <div style={{ marginTop: '6px' }}>route: {routeState.loading ? 'loading' : routeState.path ? 'ready' : 'idle'}</div>
        <div>route points: {routeState.start ? 1 : 0}{routeState.end ? ' -> 2' : ''}</div>
        <div>distance: {routeState.distanceMeters ? `${(routeState.distanceMeters / 1000).toFixed(2)} km` : '-'}</div>
        <div>duration: {routeState.durationSeconds ? `${Math.round(routeState.durationSeconds / 60)} min` : '-'}</div>
        <div style={{ maxWidth: '340px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          route error: {routeState.error || '-'}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        top: 130,
        left: 20,
        color: '#ebf7ff',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: 1.45,
        background: 'rgba(8, 18, 30, 0.86)',
        border: '1px solid rgba(120, 180, 220, 0.35)',
        padding: '10px 12px',
        borderRadius: '8px',
        minWidth: '360px',
        maxWidth: '520px'
      }}>
        <div>Address Search</div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          <input
            type='text'
            value={addressSearch.q}
            onChange={event => {
              const next = event.target.value;
              setAddressSearch(prev => ({ ...prev, q: next }));
            }}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setAddressSearch(prev => ({
                  ...prev,
                  selectedIdx:
                    prev.options.length === 0 ? -1 : Math.min(prev.selectedIdx + 1, prev.options.length - 1)
                }));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setAddressSearch(prev => ({
                  ...prev,
                  selectedIdx: prev.options.length === 0 ? -1 : Math.max(prev.selectedIdx - 1, 0)
                }));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                goToSearchSelection();
              }
            }}
            placeholder='Type an address...'
            style={{
              flex: 1,
              minWidth: 0,
              borderRadius: '6px',
              border: '1px solid rgba(140, 190, 220, 0.55)',
              background: 'rgba(9, 20, 34, 0.95)',
              color: '#e9f5ff',
              padding: '7px 8px',
              outline: 'none'
            }}
          />
          <button
            onClick={goToSearchSelection}
            disabled={addressSearch.options.length === 0}
            style={{
              borderRadius: '6px',
              border: '1px solid rgba(150, 205, 235, 0.7)',
              background: addressSearch.options.length ? 'rgba(36, 90, 126, 0.95)' : 'rgba(58, 68, 78, 0.7)',
              color: '#f4fbff',
              padding: '7px 10px',
              cursor: addressSearch.options.length ? 'pointer' : 'default'
            }}
          >
            Go
          </button>
        </div>
        <div style={{ marginTop: '6px' }}>status: {addressSearch.loading ? 'searching...' : 'idle'}</div>
        <div style={{
          marginTop: '6px',
          maxHeight: '132px',
          overflowY: 'auto',
          border: '1px solid rgba(120, 180, 220, 0.28)',
          borderRadius: '6px',
          background: 'rgba(7, 16, 28, 0.95)'
        }}>
          {addressSearch.options.length === 0 ? (
            <div style={{ padding: '8px', opacity: 0.78 }}>
              {addressSearch.q.trim().length < 3 ? 'Type at least 3 characters' : 'No matches'}
            </div>
          ) : (
            addressSearch.options.map((item, idx) => (
              <button
                key={`${item.osmType || 'osm'}-${item.osmId || idx}-${idx}`}
                onClick={() => setAddressSearch(prev => ({ ...prev, selectedIdx: idx }))}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  color: '#e8f7ff',
                  border: 'none',
                  borderBottom: idx === addressSearch.options.length - 1 ? 'none' : '1px solid rgba(120, 180, 220, 0.16)',
                  background: idx === addressSearch.selectedIdx ? 'rgba(42, 94, 128, 0.55)' : 'transparent',
                  padding: '7px 8px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.displayName}</div>
              </button>
            ))
          )}
        </div>
        <div style={{ marginTop: '6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          error: {addressSearch.error || '-'}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        bottom: 20,
        right: 20,
        color: '#e7f5ff',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: 1.45,
        background: 'rgba(8, 18, 30, 0.84)',
        border: '1px solid rgba(120, 180, 220, 0.35)',
        padding: '10px 12px',
        borderRadius: '8px',
        minWidth: '300px',
        maxWidth: '430px',
        pointerEvents: 'none'
      }}>
        <div>Nearest OSM Road</div>
        <div>coords: {Number.isFinite(osmLookup.lat) ? osmLookup.lat.toFixed(5) : '-'}, {Number.isFinite(osmLookup.lng) ? osmLookup.lng.toFixed(5) : '-'}</div>
        <div>status: {osmLookup.loading ? 'resolving...' : 'idle'}</div>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          road: {osmLookup.addressLine || '-'}
        </div>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          locality: {[osmLookup.locality, osmLookup.country].filter(Boolean).join(', ') || '-'}
        </div>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          label: {osmLookup.displayName || '-'}
        </div>
        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          error: {osmLookup.error || '-'}
        </div>
      </div>
    </div>
  );
}

export default App;
