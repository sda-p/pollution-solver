export const ABERDEEN_BOUNDS = {
  south: 56.85,
  west: -2.62,
  north: 57.42,
  east: -1.72
};

export const ABERDEEN_CENTER = {
  lat: (ABERDEEN_BOUNDS.south + ABERDEEN_BOUNDS.north) / 2,
  lng: (ABERDEEN_BOUNDS.west + ABERDEEN_BOUNDS.east) / 2
};

export const OSM_ZOOM_ALTITUDE_THRESHOLD = 1.8;
export const OSM_LOD_LEVELS = [
  { lod: 'coarse', maxRefineAltitude: 1.25, pixelSize: 1536 },
  { lod: 'medium', maxRefineAltitude: 1.12, pixelSize: 1536 },
  { lod: 'fine', maxRefineAltitude: 0.68, pixelSize: 2048 }
];
export const NEXT_LEVEL_CENTER_TRIGGER_FACTOR = 1.15;
export const TOP_CHUNK_WIDTH_DEG = ABERDEEN_BOUNDS.east - ABERDEEN_BOUNDS.west;
export const TOP_CHUNK_HEIGHT_DEG = ABERDEEN_BOUNDS.north - ABERDEEN_BOUNDS.south;
export const OSM_ABERDEEN_MAX_DISTANCE_DEG = 14;
export const MIN_CAMERA_ALTITUDE = 0.0008;
export const ZOOM_DAMPING_START_ALTITUDE = 0.22;
export const COUNTRY_POLYGON_TOGGLE_ALTITUDE = 0.12;
