const GRAPHHOPPER_BASE_URL =
  process.env.GRAPHHOPPER_BASE_URL || "http://localhost:8989";
const GRAPHHOPPER_PROFILE = process.env.GRAPHHOPPER_PROFILE || "car";
const GRAPHHOPPER_API_KEY = process.env.GRAPHHOPPER_API_KEY || "";

export async function resolveRoute({ fromLat, fromLng, toLat, toLng, profile }) {
  const routingProfile = profile || GRAPHHOPPER_PROFILE;
  const query = new URLSearchParams({
    profile: routingProfile,
    points_encoded: "false",
  });

  if (GRAPHHOPPER_API_KEY) {
    query.set("key", GRAPHHOPPER_API_KEY);
  }

  query.append("point", `${fromLat},${fromLng}`);
  query.append("point", `${toLat},${toLng}`);

  const url = `${GRAPHHOPPER_BASE_URL}/route?${query.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphHopper request failed (${response.status}): ${text}`);
  }

  return response.json();
}
