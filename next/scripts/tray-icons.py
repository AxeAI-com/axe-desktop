# Rasterizes the real Axe mark (marketing/logo-redrawn, same path as Logo.tsx) for the menu bar and
# tray, 1x (18 px) and 2x (36 px). Run: python3 scripts/tray-icons.py resources
import math, re, struct, sys, zlib

OUT = sys.argv[1]
MARK = "M1.57 169.21 L153.42 145.22 L138.73 104.91 L194.09 169.21Z M96.26 0.23 L41.12 143.74 L83.37 151.17 L0.00 166.97Z M195.25 166.73 L98.55 47.22 L70.99 80.10 L98.99 0.00Z"
POLYS = [[tuple(map(float, p.split())) for p in re.findall(r"[ML]\s*([\d.]+ [\d.]+)", sub)] for sub in MARK.split("Z") if sub.strip()]
VW, VH = 195.25, 169.21

def inside(x, y, poly):
    c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c

def render(size, ink, dot, mono=False):
    # The mark fills most of the canvas, centred; the dot sits top right with a clear ring.
    h = size * 0.86
    w = h * VW / VH
    ox, oy = (size - w) / 2, (size - h) / 2 + size * 0.02
    k = h / VH
    dc, dr, gap = (size * 0.85, size * 0.17), size * 0.14, size * 0.06
    ss = 6
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            m = d = 0
            for j in range(ss):
                for i in range(ss):
                    px, py = x + (i + 0.5) / ss, y + (j + 0.5) / ss
                    dd = math.hypot(px - dc[0], py - dc[1])
                    if dot and dd <= dr:
                        d += 1
                        continue
                    if dot and dd <= dr + gap:
                        continue
                    vx, vy = (px - ox) / k, (py - oy) / k
                    if any(inside(vx, vy, p) for p in POLYS):
                        m += 1
            n = ss * ss
            if d:
                r, g, b, a = (*(ink if mono else (0xFF, 0x9D, 0x5C)), d / n)
            else:
                (r, g, b), a = ink, m / n
            row += bytes([r, g, b, round(a * 255)])
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(t, data):
        c = struct.pack(">I", len(data)) + t + data
        return c + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")

variants = {
    # Mac: a template image, which macOS tints to match the rest of the menu bar.
    "trayTemplate": ((0, 0, 0), False),
    # Windows and Linux, on dark and light bars.
    "tray-dark": ((255, 255, 255), False),
    "tray-light": ((0, 0, 0), False),
}
for name, (ink, dot) in variants.items():
    for scale, suffix in ((1, ""), (2, "@2x")):
        open(f"{OUT}/{name}{suffix}.png", "wb").write(render(18 * scale, ink, dot, mono=name.endswith("Template")))
print("ok")
