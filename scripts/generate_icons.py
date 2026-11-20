"""Generate crisp 192x192 and 512x512 RGBA PNG PWA icons for Soundify using pure Python stdlib."""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "icons")
os.makedirs(OUT_DIR, exist_ok=True)


def write_png(path: str, size: int) -> None:
    raw = bytearray()
    bars = [
        (0.32, 0.36, 0.42, 0.58),
        (0.40, 0.44, 0.32, 0.68),
        (0.48, 0.52, 0.26, 0.74),
        (0.56, 0.60, 0.34, 0.66),
        (0.64, 0.68, 0.41, 0.59),
    ]
    for y in range(size):
        raw.append(0)  # filter type 0
        ny = y / size
        for x in range(size):
            nx = x / size
            t = 0.5 * (nx + ny)
            # Deep indigo -> electric violet -> neon rose gradient
            r = int(15 + (79 - 15) * min(1.0, t * 1.4) + (236 - 79) * max(0.0, (t - 0.45) * 1.8))
            g = int(15 + (70 - 15) * min(1.0, t * 1.4) + (72 - 70) * max(0.0, (t - 0.45) * 1.8))
            b = int(35 + (229 - 35) * min(1.0, t * 1.4) + (153 - 229) * max(0.0, (t - 0.45) * 1.8))

            dx = nx - 0.5
            dy = ny - 0.5
            dist = math.hypot(dx, dy)
            if 0.31 < dist < 0.325:
                r = min(255, r + 60)
                g = min(255, g + 60)
                b = min(255, b + 65)

            for x0, x1, y0, y1 in bars:
                if x0 <= nx <= x1 and y0 <= ny <= y1:
                    r, g, b = 255, 255, 255
                    break

            raw.extend((max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)), 255))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    write_png(os.path.join(OUT_DIR, "icon-192.png"), 192)
    write_png(os.path.join(OUT_DIR, "icon-512.png"), 512)
    print("Generated PWA PNG icons.")
