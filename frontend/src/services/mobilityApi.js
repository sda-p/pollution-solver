const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

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

export async function fetchRoute(payload) {
  const response = await fetch(`${API_BASE_URL}/routing/route`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Route request failed (${response.status})`);
  }
  return response.json();
}
