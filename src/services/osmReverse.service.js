const NOMINATIM_URL =
  process.env.OSM_NOMINATIM_URL || "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_SEARCH_URL =
  process.env.OSM_NOMINATIM_SEARCH_URL || "https://nominatim.openstreetmap.org/search";
const NOMINATIM_USER_AGENT =
  process.env.OSM_NOMINATIM_USER_AGENT || "pollution-solver/1.0 (local dev)";
const NOMINATIM_TIMEOUT_MS = Math.max(1500, Number(process.env.OSM_NOMINATIM_TIMEOUT_MS || 9000));

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function fetchNearestRoadAddress({ lat, lng }) {
  const latitude = asNumber(lat);
  const longitude = asNumber(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("Invalid coordinates for reverse geocoding.");
  }

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(latitude));
  url.searchParams.set("lon", String(longitude));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("extratags", "1");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": NOMINATIM_USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`OSM reverse geocode failed (${response.status}): ${text.slice(0, 160)}`);
    }

    const payload = await response.json();
    const address = payload?.address || {};
    const road =
      address.road ||
      address.pedestrian ||
      address.footway ||
      address.path ||
      address.cycleway ||
      null;
    const houseNumber = address.house_number || null;
    const locality =
      address.city || address.town || address.village || address.hamlet || address.suburb || null;

    return {
      query: { lat: latitude, lng: longitude },
      displayName: payload?.display_name || null,
      road,
      houseNumber,
      addressLine: road ? `${houseNumber ? `${houseNumber} ` : ""}${road}` : null,
      locality,
      state: address.state || null,
      postcode: address.postcode || null,
      country: address.country || null,
      osmType: payload?.osm_type || null,
      osmId: payload?.osm_id || null,
      class: payload?.class || null,
      type: payload?.type || null,
    };
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("OSM reverse geocode timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function searchOsmAddresses({ q, limit = 6, aroundLat, aroundLng }) {
  const query = String(q || "").trim();
  if (!query) return { query: "", results: [] };

  const maxResults = Math.min(12, Math.max(1, Math.trunc(Number(limit) || 6)));
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", query);
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(maxResults));

  const biasLat = asNumber(aroundLat);
  const biasLng = asNumber(aroundLng);
  if (Number.isFinite(biasLat) && Number.isFinite(biasLng)) {
    // Bias ranking near current view without hard-bounding search results.
    const dx = 3.5;
    const dy = 2.2;
    url.searchParams.set("viewbox", `${biasLng - dx},${biasLat + dy},${biasLng + dx},${biasLat - dy}`);
    url.searchParams.set("bounded", "0");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": NOMINATIM_USER_AGENT,
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`OSM address search failed (${response.status}): ${text.slice(0, 160)}`);
    }

    const payload = await response.json();
    const results = Array.isArray(payload)
      ? payload
          .map((item) => {
            const lat = asNumber(item?.lat);
            const lng = asNumber(item?.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            return {
              displayName: item?.display_name || "",
              lat,
              lng,
              class: item?.class || null,
              type: item?.type || null,
              importance: asNumber(item?.importance),
              osmType: item?.osm_type || null,
              osmId: item?.osm_id || null,
            };
          })
          .filter(Boolean)
      : [];

    return { query, results };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("OSM address search timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
