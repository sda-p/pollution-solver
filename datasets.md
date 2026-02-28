# Datasets Inventory and Parsing Notes

This document describes the files in `./datasets`, what each one contains, and safe ways to parse them without loading everything into memory.

## Summary Table

| File | Format | Size | What it contains |
|---|---|---:|---|
| `API_EG.EGY.PRIM.PP.KD_DS2_en_xml_v2_21105.xml` | XML (UTF-8 BOM) | 5,071,172 B | World Bank indicator `EG.EGY.PRIM.PP.KD` (energy intensity of primary energy) by country-year |
| `API_EG.EGY.PRIM.PP.KD_DS2_en_xml_v2_21105.zip` | ZIP | 109,507 B | Compressed form of the XML above (single file inside) |
| `API_EG.USE.PCAP.KG.OE_DS2_en_xml_v2_3115.xml` | XML (UTF-8 BOM) | 4,883,396 B | World Bank indicator `EG.USE.PCAP.KG.OE` (energy use per capita) by country-year |
| `API_EG.USE.PCAP.KG.OE_DS2_en_xml_v2_3115.zip` | ZIP | 154,171 B | Compressed form of the XML above (single file inside) |
| `CarbonMonitor_total_y2024_m12.nc` | NetCDF4/HDF5 | 803,572,375 B | Carbon Monitor gridded CO2 emissions dataset (December 2024 snapshot in filename) |
| `carbon-monitor-graced.gz` | `tar.gz` | 237,399,077 B | Tarball containing one file: `CarbonMonitor_total_y2024_m12.nc` |
| `.DS_Store` | macOS metadata | 6,148 B | Finder metadata, not dataset content |

## XML Datasets (World Bank)

### Files

- `API_EG.EGY.PRIM.PP.KD_DS2_en_xml_v2_21105.xml`
- `API_EG.USE.PCAP.KG.OE_DS2_en_xml_v2_3115.xml`

### Nesting / structure

Both XML files share the same structure:

`Root`  
`  data`  
`    record (repeated)`  
`      field name="Country or Area" key="XXX"`  
`      field name="Item" key="INDICATOR_CODE"`  
`      field name="Year"`  
`      field name="Value"` (can be empty/self-closing)

Observed schema details:

- `record` count: `17,556` in each XML.
- field names: `Country or Area`, `Item`, `Year`, `Value`.
- country keys: `266` distinct ISO-like entity codes.
- year range: `1960` to `2025` (inclusive).
- item key cardinality: exactly one per file:
  - `EG.EGY.PRIM.PP.KD`
  - `EG.USE.PCAP.KG.OE`
- `Value` may be missing (`<field name="Value" />`), so treat as nullable numeric.

### How to parse (recommended)

Use a streaming XML parser and map each `record` to a row:

- `country_name` = text where `field[@name='Country or Area']`
- `country_code` = `key` attribute on that same field
- `indicator_name` = text where `field[@name='Item']`
- `indicator_code` = `key` attribute on that field
- `year` = integer from `field[@name='Year']`
- `value` = float/null from `field[@name='Value']`

Notes:

- Handle UTF-8 BOM.
- Do not assume `value` exists for all country-year records.
- ZIP versions are 1:1 wrappers around the corresponding XML and can be read directly from archive streams.

## NetCDF Dataset (Carbon Monitor)

### Files

- `CarbonMonitor_total_y2024_m12.nc`
- `carbon-monitor-graced.gz` (contains the same `.nc` payload)

Verification done:

- `carbon-monitor-graced.gz` contains one tar member: `CarbonMonitor_total_y2024_m12.nc`.
- SHA-256 of standalone `.nc` and archived `.nc` are identical:
  - `12cff7792906207684aeaba1e946d0a2aacf88eedacdaebf3819124a9c21231f`

### Format-level metadata observed

- File signature confirms HDF5/NetCDF4: `\x89HDF\r\n\x1a\n`.
- Header strings show variables/attrs including:
  - `latitude`
  - `longitude`
  - `emission`
  - `units`
  - `calendar`
  - `_FillValue`

### How to parse (recommended)

Use one of:

- Python `xarray` (`engine='h5netcdf'` or default)
- Python `netCDF4`
- CLI tools like `ncdump`/`ncks` (if installed)

Example (Python, lazy/open-only):

```python
import xarray as xr

ds = xr.open_dataset("datasets/CarbonMonitor_total_y2024_m12.nc", chunks={})
print(ds.dims)
print(ds.data_vars)
print(ds.coords)
```

Practical guidance:

- Open lazily; avoid `.load()` on full arrays.
- Convert only needed slices to DataFrame (e.g., one day/region/sector at a time).
- Preserve `_FillValue` as missing data on ingest.

## Compression / container notes

- `*.zip` files each contain exactly one XML file with matching name.
- `carbon-monitor-graced.gz` is a gzip-compressed tar archive (not a plain `.nc.gz`).
