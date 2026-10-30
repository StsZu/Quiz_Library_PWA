#!/usr/bin/env python3
"""PNG icons without third-party libraries: three answer options on the MD3 primary blue, the middle one chosen.

Run from the project root: python3 scripts/make_icons.py. Icons are opaque (no transparency) and keep the
drawing inside the central 80 % so the 512 px icon also works as maskable.
"""
import math
import struct
import zlib
from pathlib import Path

BG_TOP = (11, 87, 208)
BG_BOTTOM = (8, 66, 160)
FG = (255, 255, 255)
CHECK = (20, 108, 46)
OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
# Options in canvas units 0..1: (y_center, alpha)
OPTIONS = [(0.33, 0.55), (0.50, 1.0), (0.67, 0.55)]


def sd_round_box(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - hw + r
    qy = abs(py - cy) - hh + r
    return math.hypot(max(qx, 0.0), max(qy, 0.0)) + min(max(qx, qy), 0.0) - r


def coverage(d):
    return min(max(0.5 - d, 0.0), 1.0)


def blend(col, color, c):
    return [col[i] * (1 - c) + color[i] * c for i in range(3)]


def render(size, scale=0.8):
    half = size / 2
    rows = []
    for y in range(size):
        row = bytearray([0])
        t = y / (size - 1)
        bg = [BG_TOP[i] * (1 - t) + BG_BOTTOM[i] * t for i in range(3)]
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            col = list(bg)
            for yc, alpha in OPTIONS:
                cy = half + (yc - 0.5) * size * scale
                hw, hh = 0.36 * size * scale, 0.065 * size * scale
                c = coverage(sd_round_box(px, py, half, cy, hw, hh, hh)) * alpha
                if c:
                    col = blend(col, FG, c)
            # Check mark circle on the chosen option.
            cx, cy, r = half - 0.25 * size * scale, half, 0.042 * size * scale
            c = coverage(math.hypot(px - cx, py - cy) - r)
            if c:
                col = blend(col, CHECK, c)
            row += bytes(round(v) for v in col) + b"\xff"
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size, raw):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (180, 192, 512):
        write_png(OUT / f"icon-{size}.png", size, render(size))
        print(f"icons/icon-{size}.png")


if __name__ == "__main__":
    main()
