# Routing Data Directory

This directory is used by the GraphHopper service.

## Folders

- `osm/`: place one or more `.osm.pbf` extracts here.
- `graph-cache/`: GraphHopper graph import cache/output.

## Quick start

1. Download an extract:
   ```bash
   npm run osm:download
   ```
2. Start the routing engine:
   ```bash
   npm run routing:up
   ```
3. Watch logs:
   ```bash
   npm run routing:logs
   ```
