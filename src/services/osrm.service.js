const OSRM_BASE_URL = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
const OSRM_PROFILE = process.env.OSRM_PROFILE || "driving";
const OSRM_TIMEOUT_MS = Math.max(1500, Number(process.env.OSRM_TIMEOUT_MS || 9000));

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function validatePoint(lat, lng, label) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`Invalid ${label} coordinates.`);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error(`${label} coordinates out of range.`);
  }
}

export async function fetchOsrmRoute({ startLat, startLng, endLat, endLng }) {
  const fromLat = asNumber(startLat);
  const fromLng = asNumber(startLng);
  const toLat = asNumber(endLat);
  const toLng = asNumber(endLng);

  validatePoint(fromLat, fromLng, "start");
  validatePoint(toLat, toLng, "end");

  const url = new URL(
    `/route/v1/${encodeURIComponent(OSRM_PROFILE)}/${fromLng},${fromLat};${toLng},${toLat}`,
    OSRM_BASE_URL.endsWith("/") ? OSRM_BASE_URL : `${OSRM_BASE_URL}/`,
  );
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("steps", "false");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`OSRM request failed (${response.status}): ${text.slice(0, 160)}`);
    }

    const payload = await response.json();
    if (payload?.code !== "Ok" || !Array.isArray(payload?.routes) || payload.routes.length === 0) {
      throw new Error(`OSRM routing failed: ${payload?.message || payload?.code || "no route"}`);
    }

    const route = payload.routes[0];
    const coords = Array.isArray(route?.geometry?.coordinates) ? route.geometry.coordinates : [];
    const points = coords
      .map((pair) => {
        const lng = asNumber(pair?.[0]);
        const lat = asNumber(pair?.[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [lat, lng];
      })
      .filter(Boolean);

    if (points.length < 2) {
      throw new Error("OSRM returned empty geometry.");
    }

    return {
      profile: OSRM_PROFILE,
      distanceMeters: Number(route.distance) || 0,
      durationSeconds: Number(route.duration) || 0,
      points,
      start: { lat: fromLat, lng: fromLng },
      end: { lat: toLat, lng: toLng },
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("OSRM route request timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
