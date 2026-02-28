#!/usr/bin/env bash
set -euo pipefail

if [[ $# -gt 1 ]]; then
  echo "Usage: $0 [osm-pbf-url]"
  exit 1
fi

DEFAULT_URL="https://download.geofabrik.de/europe/monaco-latest.osm.pbf"
OSM_URL="${1:-$DEFAULT_URL}"
DEST_DIR="routing/osm"
DEST_FILE="$DEST_DIR/$(basename "$OSM_URL")"

mkdir -p "$DEST_DIR"
echo "Downloading OSM extract:"
echo "  $OSM_URL"
echo "to:"
echo "  $DEST_FILE"
curl -L --fail --output "$DEST_FILE" "$OSM_URL"
echo "Done."
