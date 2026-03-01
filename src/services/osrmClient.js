const OSRM_BASE_URL = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
const OSRM_PROFILE = process.env.OSRM_PROFILE || "driving";

export async function resolveRoute({ fromLat, fromLng, toLat, toLng, profile }) {
  const routingProfile = profile || OSRM_PROFILE;
  const path = `/route/v1/${encodeURIComponent(routingProfile)}/${Number(fromLng)},${Number(
    fromLat
  )};${Number(toLng)},${Number(toLat)}`;
  const query = new URLSearchParams({
    overview: "full",
    geometries: "geojson",
    steps: "false",
    alternatives: "false",
  });

  const url = `${OSRM_BASE_URL}${path}?${query.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OSRM request failed (${response.status}) via ${OSRM_BASE_URL}: ${text.slice(0, 240)}`);
  }

  const payload = await response.json();
  if (payload?.code !== "Ok" || !Array.isArray(payload?.routes) || !payload.routes.length) {
    throw new Error(payload?.message || "OSRM returned no routes.");
  }
  return payload;
}
