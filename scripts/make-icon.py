#!/usr/bin/env python3
"""Generate the application icon.

Drawn rather than exported, because there is no design tool in the loop and an
icon committed as an opaque binary is an icon nobody can correct later. Run it
again after changing the palette and the result stays in step with the app.

The mark is the one from the masthead: the carte-de-visite's inked oval on
cream stock, with a plotted asterisk reversed out of it — the same figure the
section headings use, from the same cross-stitch reference.

Writes .icns (macOS), .ico (Windows) and a PNG (Linux) with no dependencies:
PNG is a handful of chunks around zlib-compressed scanlines, and .icns and
.ico are thin containers around PNGs.
"""
import struct, zlib, os

PAPER = (0xF0, 0xEC, 0xE1)
INK   = (0x16, 0x15, 0x0F)

# The asterisk from src/components/Motif.tsx, so icon and interface carry the
# same mark rather than two drawings of the same idea.
ASTERISK = [
    "#..#..#",
    ".#.#.#.",
    "..###..",
    "###.###",
    "..###..",
    ".#.#.#.",
    "#..#..#",
]


def draw(size):
    """One RGB image of the mark, as a list of rows of (r,g,b)."""
    px = [[PAPER] * size for _ in range(size)]

    # Supersample the ellipse edge: at 16px a hard-edged oval is a staircase.
    ss = 4
    cx = cy = (size - 1) / 2
    rx, ry = size * 0.44, size * 0.33

    for y in range(size):
        for x in range(size):
            inside = 0
            for sy in range(ss):
                for sx in range(ss):
                    fx = x + (sx + 0.5) / ss - 0.5
                    fy = y + (sy + 0.5) / ss - 0.5
                    if ((fx - cx) / rx) ** 2 + ((fy - cy) / ry) ** 2 <= 1.0:
                        inside += 1
            if inside:
                a = inside / (ss * ss)
                px[y][x] = tuple(round(PAPER[i] + (INK[i] - PAPER[i]) * a) for i in range(3))

    # The plotted figure, reversed out of the ink. Each cell is a square dot,
    # kept on whole pixels so the plotting stays countable at large sizes.
    grid = len(ASTERISK)
    cell = max(1, int(size * 0.40 / grid))
    origin = round((size - cell * grid) / 2)
    for gy, row in enumerate(ASTERISK):
        for gx, ch in enumerate(row):
            if ch != "#":
                continue
            for dy in range(cell):
                for dx in range(cell):
                    x, y = origin + gx * cell + dx, origin + gy * cell + dy
                    if 0 <= x < size and 0 <= y < size:
                        px[y][x] = PAPER
    return px


def png(px):
    size = len(px)
    raw = b"".join(b"\x00" + bytes(v for pixel in row for v in pixel) for row in px)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


SIZES = [16, 32, 64, 128, 256, 512, 1024]
images = {s: png(draw(s)) for s in SIZES}

# --- .icns ------------------------------------------------------------------
# Magic, total length, then one typed chunk per representation.
ICNS = [(b"icp4", 16), (b"icp5", 32), (b"ic11", 32), (b"ic12", 64),
        (b"ic07", 128), (b"ic08", 256), (b"ic13", 256), (b"ic09", 512),
        (b"ic14", 512), (b"ic10", 1024)]
body = b"".join(tag + struct.pack(">I", len(images[s]) + 8) + images[s] for tag, s in ICNS)
icns = b"icns" + struct.pack(">I", len(body) + 8) + body

out = os.path.join(os.path.dirname(__file__), "..", "Resale Tracker.app", "Contents", "Resources")
os.makedirs(out, exist_ok=True)
open(os.path.join(out, "icon.icns"), "wb").write(icns)

# --- .ico -------------------------------------------------------------------
ico_sizes = [16, 32, 64, 128, 256]
header = struct.pack("<HHH", 0, 1, len(ico_sizes))
offset = len(header) + 16 * len(ico_sizes)
entries, blobs = b"", b""
for s in ico_sizes:
    data = images[s]
    entries += struct.pack("<BBBBHHII", 0 if s >= 256 else s, 0 if s >= 256 else s,
                           0, 0, 1, 32, len(data), offset)
    blobs += data
    offset += len(data)
open(os.path.join(os.path.dirname(__file__), "..", "assets", "icon.ico"), "wb").write(header + entries + blobs)
open(os.path.join(os.path.dirname(__file__), "..", "assets", "icon.png"), "wb").write(images[512])

print(f"icon.icns {len(icns):,} bytes; icon.ico and icon.png in assets/")
