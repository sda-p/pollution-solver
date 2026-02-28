#!/usr/bin/env python3
import argparse
import base64
import json
from pathlib import Path

import numpy as np
from netCDF4 import Dataset


def parse_args():
    parser = argparse.ArgumentParser(description="Export downsampled CarbonMonitor bitmap heatmap.")
    parser.add_argument("--file", required=True, help="Path to CarbonMonitor NetCDF file.")
    parser.add_argument("--stride", type=int, default=8, help="Grid downsampling stride.")
    parser.add_argument(
        "--percentile",
        type=float,
        default=99.0,
        help="Upper percentile used for robust normalization.",
    )
    return parser.parse_args()


def interpolate_color(stops, t):
    x = float(np.clip(t, 0.0, 1.0))
    for idx in range(len(stops) - 1):
        p0, c0 = stops[idx]
        p1, c1 = stops[idx + 1]
        if x <= p1:
            f = 0.0 if p1 == p0 else (x - p0) / (p1 - p0)
            return (
                int(c0[0] + (c1[0] - c0[0]) * f),
                int(c0[1] + (c1[1] - c0[1]) * f),
                int(c0[2] + (c1[2] - c0[2]) * f),
            )
    return stops[-1][1]


def main():
    args = parse_args()
    nc_path = Path(args.file)
    if not nc_path.exists():
        raise SystemExit(f"Missing CarbonMonitor file: {nc_path}")

    stride = max(1, int(args.stride))
    percentile = float(np.clip(args.percentile, 90.0, 99.99))

    with Dataset(nc_path) as ds:
        latitudes = np.asarray(ds.variables["latitude"][::stride], dtype=np.float64)
        longitudes = np.asarray(ds.variables["longitude"][::stride], dtype=np.float64)
        emission = ds.variables["emission"]
        day_count = int(emission.shape[0])

        sampled = np.asarray(emission[0, ::stride, ::stride], dtype=np.float64)
        total = np.zeros_like(sampled, dtype=np.float64)
        counts = np.zeros_like(sampled, dtype=np.int32)

        for day_idx in range(day_count):
            day_slice = emission[day_idx, ::stride, ::stride]
            if np.ma.isMaskedArray(day_slice):
                values = np.asarray(day_slice.filled(np.nan), dtype=np.float64)
            else:
                values = np.asarray(day_slice, dtype=np.float64)

            valid = np.isfinite(values) & (values >= 0.0)
            total[valid] += values[valid]
            counts[valid] += 1

    mean_emission = np.divide(total, counts, out=np.zeros_like(total), where=counts > 0)
    non_zero = mean_emission[mean_emission > 0]
    if non_zero.size == 0:
        payload = {
            "image": {
                "width": int(len(longitudes)),
                "height": int(len(latitudes)),
                "rgbaBase64": "",
            },
            "meta": {
                "source": nc_path.name,
                "daysAveraged": day_count,
                "stride": stride,
                "gridWidth": int(len(longitudes)),
                "gridHeight": int(len(latitudes)),
                "normalizationPercentile": percentile,
            },
        }
        print(json.dumps(payload))
        return

    scale_value = float(np.percentile(non_zero, percentile))
    if not np.isfinite(scale_value) or scale_value <= 0:
        scale_value = float(non_zero.max())

    # Blue->cyan->yellow->red with transparency at the low end.
    color_stops = [
        (0.0, (4, 14, 36)),
        (0.25, (21, 90, 162)),
        (0.5, (49, 178, 191)),
        (0.75, (240, 195, 67)),
        (1.0, (223, 56, 45)),
    ]

    normalized = np.log1p(np.clip(mean_emission, 0.0, None)) / np.log1p(scale_value)
    normalized = np.clip(normalized, 0.0, 1.0)

    height, width = normalized.shape
    rgba = bytearray(width * height * 4)

    cursor = 0
    for y in range(height):
        for x in range(width):
            t = float(normalized[y, x])
            if t <= 0.015:
                rgba[cursor] = 0
                rgba[cursor + 1] = 0
                rgba[cursor + 2] = 0
                rgba[cursor + 3] = 0
                cursor += 4
                continue

            r, g, b = interpolate_color(color_stops, t)
            alpha = int(255 * (0.18 + 0.82 * (t**0.9)))
            rgba[cursor] = r
            rgba[cursor + 1] = g
            rgba[cursor + 2] = b
            rgba[cursor + 3] = alpha
            cursor += 4

    rgba_base64 = base64.b64encode(bytes(rgba)).decode("ascii")

    payload = {
        "image": {
            "width": int(width),
            "height": int(height),
            "rgbaBase64": rgba_base64,
        },
        "meta": {
            "source": nc_path.name,
            "daysAveraged": day_count,
            "stride": stride,
            "gridWidth": int(width),
            "gridHeight": int(height),
            "normalizationPercentile": percentile,
            "scaleValue": scale_value,
        },
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
