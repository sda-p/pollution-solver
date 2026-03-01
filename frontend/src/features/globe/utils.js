import * as THREE from 'three';
import {
  ABERDEEN_BOUNDS,
  ABERDEEN_CENTER,
  COUNTRY_POLYGON_TOGGLE_ALTITUDE,
  MIN_CAMERA_ALTITUDE,
  NEXT_LEVEL_CENTER_TRIGGER_FACTOR,
  OSM_LOD_LEVELS,
  TOP_CHUNK_HEIGHT_DEG,
  TOP_CHUNK_WIDTH_DEG,
  ZOOM_DAMPING_START_ALTITUDE
} from './constants';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const angularDistanceDeg = (lat1, lng1, lat2, lng2) => {
  const toRad = deg => (deg * Math.PI) / 180;
  const a1 = toRad(lat1);
  const b1 = toRad(lng1);
  const a2 = toRad(lat2);
  const b2 = toRad(lng2);
  const cosValue =
    Math.sin(a1) * Math.sin(a2) + Math.cos(a1) * Math.cos(a2) * Math.cos(b2 - b1);
  return (Math.acos(clamp(cosValue, -1, 1)) * 180) / Math.PI;
};

export const decodeRgbaTexture = image => {
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

export const mapWithConcurrency = async (items, limit, worker) => {
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

export const buildChunkSpecsFromTopChunks = (topChunkKeys, pov) => {
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

export const overlayOpacityFromAltitude = altitude => {
  const a = Number.isFinite(altitude) ? altitude : 2.5;
  const t = Math.max(0, Math.min(1, (a - 0.15) / 1.75));
  return 0.08 + 0.74 * t;
};

export const borderOpacityFromAltitude = altitude => {
  const a = Number.isFinite(altitude) ? altitude : 2.5;
  if (a < COUNTRY_POLYGON_TOGGLE_ALTITUDE) return 0;
  const t = Math.max(0, Math.min(1, (a - 0.15) / 1.75));
  return 0.05 + 0.6 * t;
};

export const fillOpacityFromAltitude = altitude => {
  const a = Number.isFinite(altitude) ? altitude : 2.5;
  if (a < COUNTRY_POLYGON_TOGGLE_ALTITUDE) return 0;
  const t = Math.max(0, Math.min(1, (a - 0.15) / 1.75));
  return 0.05 + 0.95 * t;
};

export const polygonAltitudeFromCamera = altitude => {
  const a = Number.isFinite(altitude) ? altitude : 2.5;
  if (a < COUNTRY_POLYGON_TOGGLE_ALTITUDE) return 0;
  const t = Math.max(0, Math.min(1, (a - 0.15) / 1.75));
  return 0.0002 + 0.0118 * t;
};

export const applyLogZoomDamping = ({ globe, pov, fallbackAltitude }) => {
  const controls = globe?.controls?.();
  if (!controls || !globe) return Number.isFinite(pov?.altitude) ? pov.altitude : fallbackAltitude;

  const radius = globe.getGlobeRadius?.() || 100;
  controls.minDistance = radius * (1 + MIN_CAMERA_ALTITUDE);

  const altitude = Number.isFinite(pov?.altitude) ? pov.altitude : fallbackAltitude;
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
