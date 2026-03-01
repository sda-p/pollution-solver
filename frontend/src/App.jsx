import { useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import { Link } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import { API_BASE_URL, fetchOsmChunk, fetchOsmReverse, fetchRoute, searchOsmAddress } from './services/mobilityApi';
import {
  ABERDEEN_BOUNDS,
  ABERDEEN_CENTER,
  COUNTRY_POLYGON_TOGGLE_ALTITUDE,
  OSM_ABERDEEN_MAX_DISTANCE_DEG,
  OSM_LOD_LEVELS,
  OSM_ZOOM_ALTITUDE_THRESHOLD,
  TOP_CHUNK_HEIGHT_DEG,
  TOP_CHUNK_WIDTH_DEG
} from './features/globe/constants';
import {
  angularDistanceDeg,
  applyLogZoomDamping,
  borderOpacityFromAltitude,
  buildChunkSpecsFromTopChunks,
  clamp,
  decodeRgbaTexture,
  fillOpacityFromAltitude,
  mapWithConcurrency,
  overlayOpacityFromAltitude,
  polygonAltitudeFromCamera
} from './features/globe/utils';
import AddressSearchPanel from './features/globe/components/AddressSearchPanel';
import CountrySidebar from './features/globe/components/CountrySidebar';
import GlobeInfoPanel from './features/globe/components/GlobeInfoPanel';
import LayerTogglesPanel from './features/globe/components/LayerTogglesPanel';
import NearestRoadPanel from './features/globe/components/NearestRoadPanel';
import OsmDebugPanel from './features/globe/components/OsmDebugPanel';
import JourneyPlannerSidebar from './features/globe/components/JourneyPlannerSidebar';

const MODE_PROFILES = ['walking', 'cycling', 'driving'];
const DRIVING_FUEL_L_PER_100KM = 7.4;
const GASOLINE_CO2_KG_PER_L = 2.31;
const CALORIES_PER_KM = {
  walking: 60,
  cycling: 30,
  driving: 0
};
const AVG_SPEED_KMH = {
  walking: 5,
  cycling: 18,
  driving: 50
};
const FOOD_CO2_KG_PER_KCAL = 0.001;

function App() {
  const globeRef = useRef();
  const carbonOverlayMaterialRef = useRef(null);
  const osmTileCacheRef = useRef(new Map());
  const osmTilePendingRef = useRef(new Map());
  const osmUpdateTimerRef = useRef(null);
  const osmRequestTokenRef = useRef(0);
  const searchTokenRef = useRef(0);
  const journeyLookupTokenRef = useRef({ from: 0, to: 0 });

  const [insights, setInsights] = useState([]);
  const [carbonBitmap, setCarbonBitmap] = useState(null);
  const [cameraAltitude, setCameraAltitude] = useState(2.5);
  const [osmTiles, setOsmTiles] = useState([]);
  const [countries, setCountries] = useState([]);
  const [countryData, setCountryData] = useState({});
  const [selectedCountry, setSelectedCountry] = useState(null);
  const [countriesByIso3, setCountriesByIso3] = useState(new Map());
  const [showCountryFill, setShowCountryFill] = useState(true);
  const [showCarbonOverlay, setShowCarbonOverlay] = useState(true);
  const [showDebugGui, setShowDebugGui] = useState(false);
  const [showJourneyPlanner, setShowJourneyPlanner] = useState(true);

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
  const [journeyLookup, setJourneyLookup] = useState({
    from: {
      loading: false,
      addressLine: '',
      displayName: '',
      error: ''
    },
    to: {
      loading: false,
      addressLine: '',
      displayName: '',
      error: ''
    }
  });
  const [journeyModeStats, setJourneyModeStats] = useState({
    loading: false,
    error: '',
    modes: {}
  });
  const journeyModeTokenRef = useRef(0);

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
    const onKeyDown = event => {
      const target = event.target;
      const tagName = target?.tagName?.toLowerCase?.();
      const isTypingTarget =
        target?.isContentEditable ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select';
      if (isTypingTarget) return;

      if (event.key === 'b' || event.key === 'B') {
        setShowDebugGui(prev => !prev);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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

  useEffect(() => {
    const point = routeState.from;
    if (!point) {
      setJourneyLookup(prev => ({
        ...prev,
        from: { loading: false, addressLine: '', displayName: '', error: '' }
      }));
      return;
    }

    const token = journeyLookupTokenRef.current.from + 1;
    journeyLookupTokenRef.current.from = token;
    setJourneyLookup(prev => ({
      ...prev,
      from: { ...prev.from, loading: true, error: '' }
    }));

    fetchOsmReverse({ lat: point.lat, lng: point.lng })
      .then(data => {
        if (token !== journeyLookupTokenRef.current.from) return;
        setJourneyLookup(prev => ({
          ...prev,
          from: {
            loading: false,
            addressLine: data?.addressLine || data?.road || '',
            displayName: data?.displayName || '',
            error: ''
          }
        }));
      })
      .catch(error => {
        if (token !== journeyLookupTokenRef.current.from) return;
        setJourneyLookup(prev => ({
          ...prev,
          from: {
            loading: false,
            addressLine: '',
            displayName: '',
            error: error?.message || 'reverse geocoding failed'
          }
        }));
      });
  }, [routeState.from]);

  useEffect(() => {
    const point = routeState.to;
    if (!point) {
      setJourneyLookup(prev => ({
        ...prev,
        to: { loading: false, addressLine: '', displayName: '', error: '' }
      }));
      return;
    }

    const token = journeyLookupTokenRef.current.to + 1;
    journeyLookupTokenRef.current.to = token;
    setJourneyLookup(prev => ({
      ...prev,
      to: { ...prev.to, loading: true, error: '' }
    }));

    fetchOsmReverse({ lat: point.lat, lng: point.lng })
      .then(data => {
        if (token !== journeyLookupTokenRef.current.to) return;
        setJourneyLookup(prev => ({
          ...prev,
          to: {
            loading: false,
            addressLine: data?.addressLine || data?.road || '',
            displayName: data?.displayName || '',
            error: ''
          }
        }));
      })
      .catch(error => {
        if (token !== journeyLookupTokenRef.current.to) return;
        setJourneyLookup(prev => ({
          ...prev,
          to: {
            loading: false,
            addressLine: '',
            displayName: '',
            error: error?.message || 'reverse geocoding failed'
          }
        }));
      });
  }, [routeState.to]);

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
    if (!showCarbonOverlay) return [];
    const texture = decodeRgbaTexture(carbonBitmap);
    if (!texture) return [];
    return [{ texture, layerType: 'carbon-overlay' }];
  }, [carbonBitmap, showCarbonOverlay]);

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
    const from = routeState.from;
    const to = routeState.to;
    if (!from || !to) {
      setJourneyModeStats({ loading: false, error: '', modes: {} });
      return;
    }

    const token = journeyModeTokenRef.current + 1;
    journeyModeTokenRef.current = token;
    setJourneyModeStats(prev => ({ ...prev, loading: true, error: '' }));

    const fallbackDistanceKm = Number.isFinite(routeState.distanceKm) ? routeState.distanceKm : null;

    Promise.all(
      MODE_PROFILES.map(async profile => {
        try {
          const payload = await fetchRoute({
            fromLat: from.lat,
            fromLng: from.lng,
            toLat: to.lat,
            toLng: to.lng,
            profile
          });
          const route = payload?.routes?.[0];
          const distanceKm = Number(route?.distance) / 1000;
          const speedKmh = AVG_SPEED_KMH[profile];
          const durationMin =
            Number.isFinite(distanceKm) && Number.isFinite(speedKmh) && speedKmh > 0
              ? (distanceKm / speedKmh) * 60
              : null;
          return {
            profile,
            distanceKm: Number.isFinite(distanceKm) ? distanceKm : fallbackDistanceKm,
            durationMin,
            error: ''
          };
        } catch (error) {
          const speedKmh = AVG_SPEED_KMH[profile];
          const durationMin =
            Number.isFinite(fallbackDistanceKm) && Number.isFinite(speedKmh) && speedKmh > 0
              ? (fallbackDistanceKm / speedKmh) * 60
              : null;
          return {
            profile,
            distanceKm: fallbackDistanceKm,
            durationMin,
            error: error?.message || `route unavailable for ${profile}`
          };
        }
      })
    ).then(results => {
      if (token !== journeyModeTokenRef.current) return;

      const modes = {};
      let combinedError = '';
      results.forEach(result => {
        const distanceKm = Number(result.distanceKm);
        const calories =
          Number.isFinite(distanceKm) && CALORIES_PER_KM[result.profile] > 0
            ? Math.round(distanceKm * CALORIES_PER_KM[result.profile])
            : null;
        const fuelLiters =
          result.profile === 'driving' && Number.isFinite(distanceKm)
            ? distanceKm * (DRIVING_FUEL_L_PER_100KM / 100)
            : null;
        const co2Kg =
          result.profile === 'driving'
            ? (Number.isFinite(fuelLiters) ? fuelLiters * GASOLINE_CO2_KG_PER_L : null)
            : (Number.isFinite(calories) ? calories * FOOD_CO2_KG_PER_KCAL : null);

        modes[result.profile] = {
          distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
          durationMin: Number.isFinite(result.durationMin) ? result.durationMin : null,
          calories,
          fuelLiters: Number.isFinite(fuelLiters) ? fuelLiters : null,
          co2Kg: Number.isFinite(co2Kg) ? co2Kg : null,
          error: result.error || ''
        };

        if (result.error && !combinedError) combinedError = result.error;
      });

      setJourneyModeStats({
        loading: false,
        error: combinedError,
        modes
      });
    });
  }, [routeState.from, routeState.to, routeState.distanceKm]);

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

  const setRouteEndpoint = async (endpoint, coords) => {
    const lat = Number(coords?.lat);
    const lng = Number(coords?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const nextPoint = { lat, lng };
    const from = endpoint === 'from' ? nextPoint : routeState.from;
    const to = endpoint === 'to' ? nextPoint : routeState.to;

    if (!from || !to) {
      setRouteState(prev => ({
        ...prev,
        from: endpoint === 'from' ? nextPoint : prev.from,
        to: endpoint === 'to' ? nextPoint : prev.to,
        loading: false,
        error: '',
        distanceKm: null,
        durationMin: null,
        awaiting: from ? 'from' : 'to',
        geojson: null
      }));
      return;
    }

    setRouteState(prev => ({
      ...prev,
      from,
      to,
      loading: true,
      error: '',
      geojson: null
    }));

    try {
      const payload = await fetchRoute({
        fromLat: from.lat,
        fromLng: from.lng,
        toLat: to.lat,
        toLng: to.lng,
        profile: routeState.profile
      });
      const route = payload?.routes?.[0];
      const distanceKm = Number(route?.distance) / 1000;
      const durationMin = Number(route?.duration) / 60;
      setRouteState(prev => ({
        ...prev,
        from,
        to,
        loading: false,
        error: '',
        distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
        durationMin: Number.isFinite(durationMin) ? durationMin : null,
        awaiting: 'from',
        geojson: route?.geometry || null
      }));
    } catch (error) {
      setRouteState(prev => ({
        ...prev,
        from,
        to,
        loading: false,
        error: error?.message || 'route lookup failed',
        distanceKm: null,
        durationMin: null,
        awaiting: 'from',
        geojson: null
      }));
    }
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

  const getCountryColor = (countryName, zoomOpacity = 1) => {
    const clampedOpacity = clamp(zoomOpacity, 0, 1);
    const data = countryData[countryName];
    if (!data) return `rgba(100,100,100,${(0.25 * clampedOpacity).toFixed(3)})`;
    const combinedMetric =
      Number(data.co2PerUnitEnergyKgPerKwh) * Number(data.energyUsePerCapitaKgOe);
    const values = countryColorMetricRange;
    if (!Number.isFinite(combinedMetric) || !Number.isFinite(values?.min) || !Number.isFinite(values?.max)) {
      return `rgba(100,100,100,${(0.25 * clampedOpacity).toFixed(3)})`;
    }
    const span = Math.max(1e-9, values.max - values.min);
    const normalized = clamp((combinedMetric - values.min) / span, 0, 1);
    const hue = 120 - normalized * 120;
    return `hsla(${hue}, 88%, 58%, ${(0.74 * clampedOpacity).toFixed(3)})`;
  };

  const countryColorMetricRange = useMemo(() => {
    const values = Object.values(countryData)
      .map(row => Number(row.co2PerUnitEnergyKgPerKwh) * Number(row.energyUsePerCapitaKgOe))
      .filter(Number.isFinite);
    if (!values.length) return null;
    return {
      min: Math.min(...values),
      max: Math.max(...values)
    };
  }, [countryData]);

  const showCountryPolygons = cameraAltitude >= COUNTRY_POLYGON_TOGGLE_ALTITUDE;

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
            const dampedAltitude = applyLogZoomDamping({
              globe: globeRef.current,
              pov,
              fallbackAltitude: cameraAltitude
            });
            const altitude = updateCameraAltitudeFromPov({ ...pov, altitude: dampedAltitude });
            if (carbonOverlayMaterialRef.current) {
              carbonOverlayMaterialRef.current.opacity = overlayOpacityFromAltitude(altitude);
            }
            scheduleOsmOverlayUpdate(pov);
          }}
          onZoom={pov => {
            const dampedAltitude = applyLogZoomDamping({
              globe: globeRef.current,
              pov,
              fallbackAltitude: cameraAltitude
            });
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
          polygonsData={showCountryPolygons ? countries : []}
          polygonGeoJsonGeometry={d => d.geometry}
          polygonCapColor={d =>
            getCountryColor(
              d.properties.NAME,
              showCountryFill ? fillOpacityFromAltitude(cameraAltitude) : 0
            )
          }
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

        {showDebugGui ? (
          <>
            <GlobeInfoPanel />
            <LayerTogglesPanel
              showCountryFill={showCountryFill}
              showCarbonOverlay={showCarbonOverlay}
              onToggleCountryFill={() => setShowCountryFill(prev => !prev)}
              onToggleCarbonOverlay={() => setShowCarbonOverlay(prev => !prev)}
            />
            <OsmDebugPanel osmDebug={osmDebug} />
            <AddressSearchPanel
              addressSearch={addressSearch}
              setAddressSearch={setAddressSearch}
              goToSearchSelection={goToSearchSelection}
            />
            <NearestRoadPanel osmLookup={osmLookup} />
          </>
        ) : null}
      </div>
      <CountrySidebar
        selectedCountry={selectedCountry}
        setSelectedCountry={setSelectedCountry}
        countryData={countryData}
      />
      <JourneyPlannerSidebar
        isOpen={showJourneyPlanner}
        setIsOpen={setShowJourneyPlanner}
        routeState={routeState}
        journeyModeStats={journeyModeStats}
        journeyLookup={journeyLookup}
        setRouteState={setRouteState}
        setRouteEndpoint={setRouteEndpoint}
        clearRouteSelection={clearRouteSelection}
      />
    </div>
  );
}

export default App;
