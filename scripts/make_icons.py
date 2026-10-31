#!/usr/bin/env python3
"""App icons «Q + галочка, версія 2» without third-party libraries (spec 002, FR-95, T119).

Run from the project root: python3 scripts/make_icons.py
The geometry and colours are read from assets/icon/icon.svg (copy of Creator_quiz/Creator_quiz-Q-check-v2/icon.svg):
the ring and the separate diagonal tail of the Q, the check mark with its background-coloured gap. The background is
drawn as a full opaque square without the rounded corners (rx) of the source, because iOS and Android round icons
themselves and iOS fills transparency with black. PNGs are RGB without an alpha channel. After writing, the 512 icon
(also used as maskable) is checked: no foreground pixel outside the safe zone, a circle of 40 % of the size.
Favicons are a separate set copied from the concept unchanged (public/favicon.*, public/icons/favicon-*.png).
"""
import math
import re
import struct
import sys
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "icon" / "icon.svg"
OUT = ROOT / "public" / "icons"
SIZES = (180, 192, 512)
SAFE_ZONE = 0.4
NS = "{http://www.w3.org/2000/svg}"


def colour(value):
    if value == "white":
        return (255, 255, 255)
    m = re.fullmatch(r"#([0-9A-Fa-f]{6})", value)
    if not m:
        raise ValueError(f"unsupported colour {value!r}")
    return tuple(int(m.group(1)[i:i + 2], 16) for i in (0, 2, 4))


def polyline(d):
    """`M x y` followed by relative `l dx dy …` pairs: the only path form the icon uses."""
    m = re.fullmatch(r"M\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*l([-\d.\s,]+)", d.strip())
    if not m:
        raise ValueError(f"unsupported path {d!r}")
    x, y = float(m.group(1)), float(m.group(2))
    deltas = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?", m.group(3))]
    points = [(x, y)]
    for dx, dy in zip(deltas[::2], deltas[1::2]):
        x, y = x + dx, y + dy
        points.append((x, y))
    return points


def read_icon(path):
    root = ET.parse(path).getroot()
    canvas = float(root.get("viewBox").split()[2])
    background, layers = None, []
    for el in root:
        tag = el.tag.replace(NS, "")
        if tag == "title":
            continue
        if tag == "rect":
            background = colour(el.get("fill"))
        elif tag == "circle":
            layers.append(("ring", colour(el.get("stroke")), float(el.get("stroke-width")) / 2,
                           (float(el.get("cx")), float(el.get("cy")), float(el.get("r")))))
        elif tag == "path":
            if el.get("stroke-linecap") != "round":
                raise ValueError("only round caps are supported")
            layers.append(("line", colour(el.get("stroke")), float(el.get("stroke-width")) / 2, polyline(el.get("d"))))
        else:
            raise ValueError(f"unsupported element {tag}")
    if background is None:
        raise ValueError("no background rect")
    return canvas, background, layers


def segment_distance(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)))
    return math.hypot(px - ax - t * vx, py - ay - t * vy)


def distance(layer, u, v):
    kind, _, half_width, shape = layer
    if kind == "ring":
        cx, cy, r = shape
        return abs(math.hypot(u - cx, v - cy) - r) - half_width
    return min(segment_distance(u, v, *a, *b) for a, b in zip(shape, shape[1:])) - half_width


def render(size, canvas, background, layers):
    scale = size / canvas
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            u, v = (x + 0.5) / scale, (y + 0.5) / scale
            col = list(background)
            for layer in layers:
                c = min(max(0.5 - distance(layer, u, v) * scale, 0.0), 1.0)
                if c:
                    col = [col[i] * (1 - c) + layer[1][i] * c for i in range(3)]
            raw += bytes(round(value) for value in col)
    return bytes(raw)


def write_png(path, size, raw):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # colour type 2: RGB, no alpha
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def outside_safe_zone(size, raw, background):
    count, stride = 0, size * 3 + 1
    for y in range(size):
        for x in range(size):
            pixel = raw[y * stride + 1 + x * 3: y * stride + 4 + x * 3]
            if max(abs(pixel[i] - background[i]) for i in range(3)) > 40 and \
                    math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > SAFE_ZONE * size:
                count += 1
    return count


def main():
    canvas, background, layers = read_icon(SOURCE)
    OUT.mkdir(parents=True, exist_ok=True)
    rendered = {}
    for size in SIZES:
        rendered[size] = render(size, canvas, background, layers)
        write_png(OUT / f"icon-{size}.png", size, rendered[size])
        print(f"icons/icon-{size}.png")
    outside = outside_safe_zone(512, rendered[512], background)
    print(f"maskable 512: {outside} foreground pixels outside the {SAFE_ZONE:.0%} safe zone")
    return 0 if outside == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
