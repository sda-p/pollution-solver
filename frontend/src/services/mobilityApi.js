const defaultApiBase =
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : "http://localhost:3001";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || defaultApiBase;

export async function fetchOsmFeatures(payload) {
  const response = await fetch(`${API_BASE_URL}/osm/features`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`OSM request failed (${response.status})`);
  }
  return response.json();
}

export async function fetchOsmChunk(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.set(key, String(value));
  });
  const response = await fetch(`${API_BASE_URL}/osm/chunk?${query.toString()}`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OSM chunk request failed (${response.status}) ${body.slice(0, 180)}`);
  }
  return response.json();
}

export async function fetchOsmReverse(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.set(key, String(value));
  });
  const response = await fetch(`${API_BASE_URL}/osm/reverse?${query.toString()}`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OSM reverse request failed (${response.status}) ${body.slice(0, 180)}`);
  }
  return response.json();
}

export async function searchOsmAddress(params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null) query.set(key, String(value));
  });
  const response = await fetch(`${API_BASE_URL}/osm/search?${query.toString()}`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OSM search request failed (${response.status}) ${body.slice(0, 180)}`);
  }
  return response.json();
}

export async function fetchRoute(payload) {
  const response = await fetch(`${API_BASE_URL}/routing/route`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Route request failed (${response.status}) ${body.slice(0, 180)}`);
  }
  return response.json();
}
