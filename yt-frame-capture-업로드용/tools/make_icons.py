#!/usr/bin/env python3
"""Generate the extension's PNG icons without any image library.

Renders a camera glyph on a rounded red tile at 4x and box-downsamples it,
which is enough anti-aliasing for icons this small.
"""
import os
import struct
import zlib

SS = 4  # supersampling factor
RED = (204, 0, 0)
WHITE = (255, 255, 255)
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")


def rounded_rect(x, y, w, h, r):
    """Return a predicate telling whether (px, py) is inside the rounded rect."""
    def inside(px, py):
        if not (x <= px <= x + w and y <= py <= y + h):
            return False
        cx = min(max(px, x + r), x + w - r)
        cy = min(max(py, y + r), y + h - r)
        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
    return inside


def circle(cx, cy, r):
    return lambda px, py: (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def render(size):
    n = size * SS
    u = n / 36.0  # design grid is 36x36

    tile = rounded_rect(0, 0, n - 1, n - 1, 7.5 * u)
    body = rounded_rect(4.5 * u, 10.5 * u, 27 * u, 18 * u, 3 * u)
    bump = rounded_rect(12.5 * u, 7.2 * u, 11 * u, 5 * u, 1.6 * u)
    lens_outer = circle(18 * u, 19.6 * u, 6.2 * u)
    lens_inner = circle(18 * u, 19.6 * u, 3.6 * u)
    finder = circle(26.6 * u, 14.6 * u, 1.35 * u)

    rows = []
    for py in range(n):
        row = bytearray()
        yc = py + 0.5
        for px in range(n):
            xc = px + 0.5
            if not tile(xc, yc):
                row += b"\x00\x00\x00\x00"
                continue
            white = (body(xc, yc) or bump(xc, yc)) and not lens_outer(xc, yc)
            white = white or (lens_outer(xc, yc) and not lens_inner(xc, yc))
            white = white or finder(xc, yc)
            r, g, b = WHITE if white else RED
            row += bytes((r, g, b, 255))
        rows.append(bytes(row))
    return downsample(rows, n, size)


def downsample(rows, n, size):
    out = []
    for oy in range(size):
        row = bytearray()
        for ox in range(size):
            acc = [0, 0, 0, 0]
            for dy in range(SS):
                src = rows[oy * SS + dy]
                base = (ox * SS) * 4
                for dx in range(SS):
                    i = base + dx * 4
                    a = src[i + 3]
                    acc[0] += src[i] * a
                    acc[1] += src[i + 1] * a
                    acc[2] += src[i + 2] * a
                    acc[3] += a
            total_a = acc[3]
            if total_a == 0:
                row += b"\x00\x00\x00\x00"
            else:
                row += bytes((
                    acc[0] // total_a,
                    acc[1] // total_a,
                    acc[2] // total_a,
                    total_a // (SS * SS),
                ))
        out.append(bytes(row))
    return out


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for s in (16, 32, 48, 128):
        path = os.path.join(OUT_DIR, "icon%d.png" % s)
        write_png(path, render(s), s)
        print("wrote", os.path.relpath(path), os.path.getsize(path), "bytes")
