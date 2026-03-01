import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import { Link } from 'react-router-dom'; // <--- Add this
import { Trophy, Globe as GlobeIcon } from 'lucide-react'; // <--- Add this
import SidebarWidget from './layout/SidebarWidget.jsx';import { API_BASE_URL, fetchOsmChunk, fetchOsmReverse, fetchRoute, searchOsmAddress } from './services/mobilityApi';

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
  const searchTokenRef = useRef(0);

  const [insights, setInsights] = useState([]);
  const [carbonBitmap, setCarbonBitmap] = useState(null);
  const [cameraAltitude, setCameraAltitude] = useState(2.5);
  const [osmTiles, setOsmTiles] = useState([]);
  const [countries, setCountries] = useState([]);
  const [countryData, setCountryData] = useState({});
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [countriesByIso3, setCountriesByIso3] = useState(new Map());

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

  const [clickMarker, setClickMarker] = useState(null);
  const [selectedAddressMarker, setSelectedAddressMarker] = useState(null);
  const [routeState, setRouteState] = useState({
    from: null,
    to: null,
    loading: false,
    error: '',
    distanceKm: null,
    durationMin: null,
    profile: 'driving',
    awaiting: 'from',
    geojson: null
  });

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
    return 0.0002 + 0.0118 * t;
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
    const logScaled = Math.log10(1 + 9 * normalized);
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


  // NEW: Achievement Tracking State
  const [stats, setStats] = useState(() => {
    const saved = localStorage.getItem('eco_stats');
    return saved ? JSON.parse(saved) : { routesFound: 0, addressesSearched: 0, countriesExplored: [] };
  });

  // Update localStorage whenever stats change
  useEffect(() => {
    localStorage.setItem('eco_stats', JSON.stringify(stats));
  }, [stats]);

  // Helper to trigger achievement progress
  const trackAction = (type, value) => {
    setStats(prev => {
      if (type === 'route') return { ...prev, routesFound: prev.routesFound + 1 };
      if (type === 'search') return { ...prev, addressesSearched: prev.addressesSearched + 1 };
      if (type === 'country' && !prev.countriesExplored.includes(value)) {
        return { ...prev, countriesExplored: [...prev.countriesExplored, value] };
      }
      return prev;
    });
  };

  useEffect(() => {
    fetch(`${API_BASE_URL}/insights`)
      .then(res => res.json())
      .then(data => {
        setInsights(data.pollutionPoints || []);
        setCountryData(data.countryData || {});
      })
      .catch(() => {
        setInsights([]);
        setCountryData({});
      });
  }, []);

  useEffect(() => {
    fetch(`${API_BASE_URL}/insights/carbon-monitor?stride=8&percentile=99.3`)
      .then(res => res.json())
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

  const routePathData = useMemo(() => {
    const geometry = routeState.geojson;
    const coordinates = geometry?.type === 'LineString' ? geometry.coordinates : null;
    if (!coordinates?.length) return [];
    const points = coordinates
      .map(coord => ({
        lat: Number(coord?.[1]),
        lng: Number(coord?.[0])
      }))
      .filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng));
    if (points.length < 2) return [];
    return [
      {
        id: 'selected-route',
        points
      }
    ];
  }, [routeState.geojson]);

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
    })
      .then(payload => {
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
      })
      .finally(() => {
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
    const specs = active ? buildChunkSpecsFromTopChunks(['0:0'], pov) : [];

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

    resolveNearestRoad({ lat, lng });
    trackAction('search'); // <--- Track successful search
  };

  const clearRouteSelection = () => {
    setRouteState(prev => ({
      ...prev,
      from: null,
      to: null,
      loading: false,
      error: '',
      distanceKm: null,
      durationMin: null,
      awaiting: 'from',
      geojson: null
    }));
  };

  const pickRoutePoint = async coords => {
    const lat = Number(coords?.lat);
    const lng = Number(coords?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    if (!routeState.from || (routeState.from && routeState.to)) {
      setRouteState(prev => ({
        ...prev,
        from: { lat, lng },
        to: null,
        loading: false,
        error: '',
        distanceKm: null,
        durationMin: null,
        awaiting: 'to',
        geojson: null
      }));
      return;
    }

    const from = routeState.from;
    setRouteState(prev => ({
      ...prev,
      to: { lat, lng },
      loading: true,
      error: '',
      awaiting: 'to',
      geojson: null
    }));

    try {
      const payload = await fetchRoute({
        fromLat: from.lat,
        fromLng: from.lng,
        toLat: lat,
        toLng: lng,
        profile: routeState.profile
      });
      const route = payload?.routes?.[0];
      const distanceKm = Number(route?.distance) / 1000;
      const durationMin = Number(route?.duration) / 60;
      setRouteState(prev => ({
        ...prev,
        to: { lat, lng },
        loading: false,
        error: '',
        distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
        durationMin: Number.isFinite(durationMin) ? durationMin : null,
        awaiting: 'from',
        geojson: route?.geometry || null
      }));
      trackAction('route'); // <--- Track successful route trace
    } catch (error) {
      setRouteState(prev => ({
        ...prev,
        to: { lat, lng },
        loading: false,
        error: error?.message || 'route lookup failed',
        distanceKm: null,
        durationMin: null,
        awaiting: 'from',
        geojson: null
      }));
    }
  };

  const getCountryColor = countryName => {
    const data = countryData[countryName];
    if (!data) return 'rgba(100,100,100,0.25)';
    const score = Math.min(data.energyUsePerCapitaKgOe || 0, 15000) / 150;
    const hue = 120 - score * 1.2;
    return `hsla(${hue}, 88%, 58%, 0.74)`;
  };

  return (
    <div className="h-screen bg-emerald-950 text-white flex flex-col overflow-hidden font-sans">
      <div className="fixed top-0 left-0 right-0 z-50 navbar bg-emerald-950/80 backdrop-blur-3xl border-b border-emerald-400/30 px-8 py-6">
        <div className="navbar-start flex items-center gap-4">
          <span className="text-4xl">🌍</span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-emerald-50">Pollution Solver</h1>
            <p className="text-xs text-emerald-400/90 -mt-1 uppercase tracking-widest">see • choose • improve</p>
          </div>
        </div>
        {/* New Navigation Link */}
        <div className="navbar-end gap-3">
          <Link 
            to="/achievements" 
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-50 hover:bg-emerald-500/20 transition-all"
          >
            <Trophy className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold">Achievements</span>
            {/* Badge showing progress */}
            <span className="bg-emerald-500 text-emerald-950 text-[10px] px-1.5 rounded-full">
              {stats.routesFound + stats.addressesSearched}
            </span>
          </Link>
        </div>
      </div>

      <div className="flex-1 pt-24 relative overflow-hidden">
        <Globe
          ref={globeRef}
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-day.jpg"
          bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
          backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
          showAtmosphere={true}
          atmosphereColor="#a0d8ff"
          atmosphereAltitude={0.25}
          pointsData={[]}
          pointLat={d => d.lat}
          pointLng={d => d.lng}
          pointColor={d => d.color || '#ff4444'}
          pointAltitude={d => d.size}
          pointRadius={0.24}
          pointLabel={d =>
            `<b>${d.countryName}</b><br/>${d.indicatorCode}: ${d.value?.toFixed?.(2) ?? d.value}<br/>Year: ${d.year}`
          }
          labelsData={[
            clickMarker,
            selectedAddressMarker,
            routeState.from
              ? {
                  id: `route-from:${routeState.from.lat.toFixed(5)}:${routeState.from.lng.toFixed(5)}`,
                  lat: routeState.from.lat,
                  lng: routeState.from.lng,
                  color: '#f59e0b',
                  dotRadius: 0.00055,
                  altitude: 0.0003001
                }
              : null,
            routeState.to
              ? {
                  id: `route-to:${routeState.to.lat.toFixed(5)}:${routeState.to.lng.toFixed(5)}`,
                  lat: routeState.to.lat,
                  lng: routeState.to.lng,
                  color: '#ef4444',
                  dotRadius: 0.00055,
                  altitude: 0.0003001
                }
              : null
          ].filter(Boolean)}
          labelLat={d => d.lat}
          labelLng={d => d.lng}
          labelText={() => ''}
          labelColor={d => d.color}
          labelSize={0.0001}
          labelDotRadius={d => d.dotRadius || 0.0001}
          labelAltitude={d => d.altitude || 0.0003001}
          pathsData={routePathData}
          pathPoints={path => path.points}
          pathPointLat={point => point.lat}
          pathPointLng={point => point.lng}
          pathPointAlt={() => 0.0003002}
          pathColor={() => '#00ffd0'}
          pathStroke={3.55}
          pathDashLength={0.16}
          pathDashGap={0.08}
          pathDashAnimateTime={2200}
          pathTransitionDuration={0}
          customLayerData={carbonOverlayData}
          customThreeObject={layer => {
            const radius = (globeRef.current?.getGlobeRadius?.() || 100) * 1.018;
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
            if (data?.geometry && data?.properties) return true;
            return true;
          }}
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
            resolveNearestRoad(coords, { fromClick: true });
            pickRoutePoint(coords);
          }}
          polygonsData={countries}
          polygonGeoJsonGeometry={d => d.geometry}
          polygonCapColor={d => getCountryColor(d.properties.NAME)}
          polygonSideColor={() =>
            `rgba(255,255,255,${(borderOpacityFromAltitude(cameraAltitude) * 0.45).toFixed(3)})`
          }
          polygonStrokeColor={() =>
            `rgba(255,255,255,${borderOpacityFromAltitude(cameraAltitude).toFixed(3)})`
          }
          polygonAltitude={polygonAltitudeFromCamera(cameraAltitude)}
          polygonLabel={d => `<b>${d.properties.NAME}</b>`}
          onPolygonClick={(d, event, coords) => {
            void d;
            void event;
            resolveNearestRoad(coords, { fromClick: true });
            pickRoutePoint(coords);
          }}
          onPolygonRightClick={(d, event) => {
            event?.preventDefault?.();
            setSelectedCountry(d.properties.NAME);
            trackAction('country', d.properties.NAME); // <--- Track country exploration
          }}
          onPolygonHover={polygon => {
            void polygon;
          }}
        />

        <div className="pointer-events-none absolute top-5 left-5 rounded-2xl border border-emerald-400/30 bg-emerald-950/70 p-4 backdrop-blur-xl">
          <h2 className="text-lg font-semibold text-emerald-50">Global Emissions Globe</h2>
          <p className="text-xs text-emerald-300/80">Carbon bitmap + OSM LoD overlays enabled</p>
        </div>

        <div className="absolute top-5 right-5 w-80 rounded-2xl border border-white/10 bg-slate-950/75 p-4 text-xs text-slate-100 backdrop-blur-xl">
          <div className="mb-2 text-sm font-semibold text-cyan-200">OSM LoD Debug</div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px] leading-relaxed text-cyan-100/90">
            <div>pov lat/lng</div>
            <div>{osmDebug.lat.toFixed(2)}, {osmDebug.lng.toFixed(2)}</div>
            <div>altitude</div>
            <div>{osmDebug.altitude.toFixed(3)}</div>
            <div>overlay active</div>
            <div>{osmDebug.active ? 'yes' : 'no'}</div>
            <div>requested</div>
            <div>{osmDebug.requested}</div>
            <div>visible</div>
            <div>{osmDebug.visible}</div>
            <div>lod c/m/f</div>
            <div>{osmDebug.coarse}/{osmDebug.medium}/{osmDebug.fine}</div>
            <div>cache ready</div>
            <div>{osmDebug.cacheReady ? 'yes' : 'no'}</div>
            <div>cache size</div>
            <div>{osmDebug.cacheSize}</div>
            <div>last fetch</div>
            <div>{osmDebug.fetchMs} ms</div>
            <div>failed</div>
            <div>{osmDebug.failed}</div>
            <div>status</div>
            <div>{osmDebug.loading ? 'loading' : 'idle'}</div>
          </div>
          <div className="mt-2 truncate font-mono text-[11px] text-rose-200/90">error: {osmDebug.error || '-'}</div>
        </div>

        <div className="absolute top-36 left-5 w-[min(30rem,calc(100vw-2.5rem))] rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-100 backdrop-blur-xl">
          <div className="mb-2 text-sm font-semibold text-emerald-200">Address Search</div>
          <div className="flex gap-2">
            <input
              type="text"
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
                      prev.options.length === 0
                        ? -1
                        : Math.min(prev.selectedIdx + 1, prev.options.length - 1)
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
              placeholder="Type an address..."
              className="flex-1 rounded-xl border border-cyan-300/40 bg-slate-900/95 px-3 py-2 text-cyan-50 outline-none transition-colors focus:border-cyan-200"
            />
            <button
              onClick={goToSearchSelection}
              disabled={addressSearch.options.length === 0}
              className="rounded-xl border border-cyan-200/60 px-4 py-2 font-semibold text-cyan-50 transition-colors disabled:cursor-default disabled:border-slate-500/40 disabled:bg-slate-700/40 disabled:text-slate-300 enabled:bg-cyan-700/70 enabled:hover:bg-cyan-600/80"
            >
              Go
            </button>
          </div>
          <div className="mt-2 font-mono text-[11px] text-cyan-100/90">status: {addressSearch.loading ? 'searching...' : 'idle'}</div>
          <div className="mt-2 max-h-36 overflow-y-auto rounded-xl border border-cyan-300/20 bg-slate-900/80">
            {addressSearch.options.length === 0 ? (
              <div className="px-3 py-2 text-cyan-100/70">
                {addressSearch.q.trim().length < 3 ? 'Type at least 3 characters' : 'No matches'}
              </div>
            ) : (
              addressSearch.options.map((item, idx) => (
                <button
                  key={`${item.osmType || 'osm'}-${item.osmId || idx}-${idx}`}
                  onClick={() => setAddressSearch(prev => ({ ...prev, selectedIdx: idx }))}
                  className={`w-full border-b border-cyan-300/15 px-3 py-2 text-left font-mono text-[11px] text-cyan-50 last:border-b-0 ${
                    idx === addressSearch.selectedIdx ? 'bg-cyan-700/45' : 'bg-transparent hover:bg-cyan-900/35'
                  }`}
                >
                  <div className="truncate">{item.displayName}</div>
                </button>
              ))
            )}
          </div>
          <div className="mt-2 truncate font-mono text-[11px] text-rose-200/90">error: {addressSearch.error || '-'}</div>
        </div>

        <div className="pointer-events-none absolute bottom-5 right-5 w-[min(27rem,calc(100vw-2.5rem))] rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-100 backdrop-blur-xl">
          <div className="mb-2 text-sm font-semibold text-cyan-100">Nearest OSM Road</div>
          <div className="space-y-1 font-mono text-[11px] text-cyan-100/90">
            <div>coords: {Number.isFinite(osmLookup.lat) ? osmLookup.lat.toFixed(5) : '-'}, {Number.isFinite(osmLookup.lng) ? osmLookup.lng.toFixed(5) : '-'}</div>
            <div>status: {osmLookup.loading ? 'resolving...' : 'idle'}</div>
            <div className="truncate">road: {osmLookup.addressLine || '-'}</div>
            <div className="truncate">locality: {[osmLookup.locality, osmLookup.country].filter(Boolean).join(', ') || '-'}</div>
            <div className="truncate">label: {osmLookup.displayName || '-'}</div>
            <div className="truncate text-rose-200/90">error: {osmLookup.error || '-'}</div>
          </div>
        </div>

        <div className="absolute bottom-5 left-5 w-[min(26rem,calc(100vw-2.5rem))] rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-100 backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-amber-100">Route Trace (OSRM)</div>
            <button
              onClick={clearRouteSelection}
              className="rounded-lg border border-amber-200/40 px-2 py-1 text-[11px] font-semibold text-amber-100 hover:bg-amber-800/25"
            >
              Reset
            </button>
          </div>
          <div className="space-y-1 font-mono text-[11px] text-amber-100/90">
            <div>
              from: {routeState.from ? `${routeState.from.lat.toFixed(5)}, ${routeState.from.lng.toFixed(5)}` : '-'}
            </div>
            <div>
              to: {routeState.to ? `${routeState.to.lat.toFixed(5)}, ${routeState.to.lng.toFixed(5)}` : '-'}
            </div>
            <div>status: {routeState.loading ? 'routing...' : `click ${routeState.awaiting}`}</div>
            <div>distance: {Number.isFinite(routeState.distanceKm) ? `${routeState.distanceKm.toFixed(2)} km` : '-'}</div>
            <div>duration: {Number.isFinite(routeState.durationMin) ? `${routeState.durationMin.toFixed(1)} min` : '-'}</div>
            <div className="truncate text-rose-200/90">error: {routeState.error || '-'}</div>
          </div>
        </div>
      </div>

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
                      <div className="text-emerald-400 text-xs uppercase font-bold tracking-tighter">Energy Use / Capita</div>
                      <div className="text-2xl font-bold text-red-400 mt-1">
                        {Number.isFinite(countryData[selectedCountry].energyUsePerCapitaKgOe)
                          ? countryData[selectedCountry].energyUsePerCapitaKgOe.toFixed(2)
                          : '-'}
                      </div>
                      <div className="mt-1 text-[10px] text-emerald-300/80">
                        {countryData[selectedCountry].energyUseYear || '-'} • kg oil eq.
                      </div>
                    </div>
                    <div className="p-4 bg-emerald-900/30 rounded-2xl border border-emerald-800/50">
                      <div className="text-emerald-400 text-xs uppercase font-bold tracking-tighter">Primary Energy PPP</div>
                      <div className="text-2xl font-bold text-orange-400 mt-1">
                        {Number.isFinite(countryData[selectedCountry].primaryEnergyPerPppKd)
                          ? countryData[selectedCountry].primaryEnergyPerPppKd.toFixed(3)
                          : '-'}
                      </div>
                      <div className="mt-1 text-[10px] text-emerald-300/80">
                        {countryData[selectedCountry].primaryEnergyYear || '-'} • indicator scale
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-emerald-900/20 rounded-xl mb-8 border border-emerald-800/30 text-emerald-400/60 italic text-sm">
                  Basic data loaded. Select a major hub for detailed transport metrics.
                </div>
              )}

              <SidebarWidget location={selectedCountry} countryMetrics={countryData[selectedCountry]} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
