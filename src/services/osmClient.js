const OVERPASS_URL =
  process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";

function buildOverpassQuery({ south, west, north, east, amenity, highway }) {
  const filters = [];
  if (amenity) filters.push(`["amenity"="${amenity}"]`);
  if (highway) filters.push(`["highway"="${highway}"]`);
  const filterString = filters.join("");

  return `
[out:json][timeout:25];
(
  node${filterString}(${south},${west},${north},${east});
  way${filterString}(${south},${west},${north},${east});
);
out body;
>;
out skel qt;
`.trim();
}

export async function fetchOsmElements(params) {
  const query = buildOverpassQuery(params);
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Overpass request failed (${response.status}): ${text}`);
  }

  const json = await response.json();
  return json.elements || [];
}
