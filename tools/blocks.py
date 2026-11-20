"""Build the block-character dancer for one drawing style and height.

The dancer's picture frames (assets/png, 168 x 192, a clear ground) are cut
into text cells, each cell into dots: half 1 x 2, sextant 2 x 3, octant and
braille 2 x 4. A dot is lit where the picture covers at least half of it. A
cell with clear dots draws its lit dots in their colour on the terminal's own
ground; a cell lit all over is split by brightness into two groups, the
brighter drawn as the glyph's dots and the other as its ground (one colour
alone where the two are close). Every colour is then mapped to a palette of
at most 89 colours, each named by a letter.

A frame is code points, cell by cell, row-major: '.' for an empty cell, else
three: the glyph, the fg palette letter and the bg palette letter ('.' for
the terminal's own ground). hooks/dancer.tsx draws it.

A cell is twice as tall as it is wide, so the picture is round(height * 1.75)
columns wide (the box is ceil(height * 1.75) columns), centred.

usage:
  python -I blocks.py build <mod dir> <style> <height> [out file]
      writes <out file or mod dir/assets/sprites/<style>-<height>.json>
  python -I blocks.py preview <sprite.json> <frame> <out.png>
      draws one frame's cells dot by dot, to check a build by eye
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

FRAMES = 418
FPS = 12
FRAME_W, FRAME_H = 168, 192
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+,-/:;<=>?@[]^_{|}~"
SOLID = 14.0  # two colours closer than this (0-255 RGB distance) draw as one
DOTS = {"half": (1, 2), "sextant": (2, 3), "octant": (2, 4), "braille": (2, 4)}


def bit(style: str, row: int, col: int) -> int:
    """The bit a dot sets in its cell's pattern."""
    if style == "braille":
        return [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]][row][col]
    dx = DOTS[style][0]
    return 1 << (row * dx + col)


def glyphs(style: str) -> dict:
    """Pattern (bits) to glyph, every pattern but 0 (no dot lit)."""
    n = DOTS[style][0] * DOTS[style][1]
    full = (1 << n) - 1
    if style == "half":
        return {1: "▀", 2: "▄", 3: "█"}
    if style == "braille":
        return {v: chr(0x2800 + v) for v in range(1, 256)}
    if style == "sextant":
        # U+1FB00 on, in pattern order, less the three the block elements hold.
        table = {21: "▌", 42: "▐", full: "█"}
        rest = [v for v in range(1, full) if v not in table]
        table.update({v: chr(0x1FB00 + i) for i, v in enumerate(rest)})
        return table
    # Octants: U+1CD00 on (Unicode 16), in pattern order, less the 25 patterns
    # older blocks hold: the quadrants and halves, the quarter and three-quarter
    # blocks, and the one-dot corners and middle quarters.
    table = {
        5: "▘", 10: "▝", 80: "▖", 160: "▗", 15: "▀", 240: "▄", 85: "▌", 170: "▐",
        165: "▚", 90: "▞", 245: "▙", 95: "▛", 175: "▜", 250: "▟", full: "█",
        3: "\U0001FB82", 192: "▂", 63: "\U0001FB85", 252: "▆",
        1: "\U0001CEA8", 2: "\U0001CEAB", 64: "\U0001CEA3", 128: "\U0001CEA0",
        20: "\U0001FBE6", 40: "\U0001FBE7",
    }
    rest = [v for v in range(1, full) if v not in table]
    assert len(rest) == 230, len(rest)
    table.update({v: chr(0x1CD00 + i) for i, v in enumerate(rest)})
    return table


def dots_of(png: Path, style: str, rows: int, cols: int) -> tuple:
    """The frame's dots: colour (rows, cols, n, 3) and cover (rows, cols, n)."""
    dx, dy = DOTS[style]
    image = np.asarray(Image.open(png).convert("RGBA"), dtype=np.float32) / 255.0
    alpha = image[..., 3]
    width = round(rows * 1.75 * dx)
    height = rows * dy

    def shrink(channel: np.ndarray) -> np.ndarray:
        return np.asarray(Image.fromarray(channel, "F").resize((width, height), Image.BOX))

    cover = shrink(alpha)
    rgb = np.stack([shrink(image[..., c] * alpha) for c in range(3)], -1)
    rgb = np.where(cover[..., None] > 1e-6, rgb / np.maximum(cover[..., None], 1e-6), 0.0) * 255.0
    pad = cols * dx - width
    left = pad // 2
    cover = np.pad(cover, ((0, 0), (left, pad - left)))
    rgb = np.pad(rgb, ((0, 0), (left, pad - left), (0, 0)))
    # (rows, dy, cols, dx) -> (rows, cols, dy * dx), dots row-major in a cell.
    cover = cover.reshape(rows, dy, cols, dx).transpose(0, 2, 1, 3).reshape(rows, cols, dx * dy)
    rgb = rgb.reshape(rows, dy, cols, dx, 3).transpose(0, 2, 1, 3, 4).reshape(rows, cols, dx * dy, 3)
    return rgb, cover


def cells_of(rgb: np.ndarray, cover: np.ndarray, style: str) -> list:
    """Each cell as None or (pattern, fg rgb, bg rgb or None)."""
    dx, dy = DOTS[style]
    bits = np.array([bit(style, i // dx, i % dx) for i in range(dx * dy)])
    full = int(bits.sum())
    lit = cover >= 0.5
    count = lit.sum(-1)
    lum = rgb @ np.array([0.299, 0.587, 0.114])
    rows, cols = count.shape
    out = []
    for r in range(rows):
        line = []
        for c in range(cols):
            if count[r, c] == 0:
                line.append(None)
                continue
            if count[r, c] < dx * dy:
                mask = lit[r, c]
                line.append((int(bits[mask].sum()), rgb[r, c][mask].mean(0), None))
                continue
            bright = lum[r, c] >= lum[r, c].mean()
            fg = rgb[r, c][bright].mean(0)
            if bright.all() or np.linalg.norm(fg - rgb[r, c][~bright].mean(0)) < SOLID:
                colour = rgb[r, c].mean(0)
                line.append((full, colour, colour if style == "braille" else None))
                continue
            line.append((int(bits[bright].sum()), fg, rgb[r, c][~bright].mean(0)))
        out.append(line)
    return out


def palette_of(colours: np.ndarray, k: int) -> np.ndarray:
    """k colours standing for all of them: k-means from a spread start."""
    rng = np.random.default_rng(1)
    sample = colours[rng.choice(len(colours), min(len(colours), 60000), replace=False)]
    order = np.argsort(sample @ np.array([0.299, 0.587, 0.114]))
    centres = sample[order[np.linspace(0, len(order) - 1, k).astype(int)]].copy()
    for _ in range(20):
        near = ((sample[:, None, :] - centres[None]) ** 2).sum(-1).argmin(1)
        for i in range(k):
            members = sample[near == i]
            if len(members):
                centres[i] = members.mean(0)
    return centres


def build(mod: Path, style: str, rows: int, out: Path) -> None:
    cols = math.ceil(rows * 1.75)
    table = glyphs(style)
    frames = []
    for n in range(FRAMES):
        rgb, cover = dots_of(mod / "assets" / "png" / f"f{n:04d}.png", style, rows, cols)
        frames.append(cells_of(rgb, cover, style))
    colours = np.array([c for f in frames for line in f for cell in line if cell for c in cell[1:] if c is not None])
    centres = palette_of(colours, len(ALPHABET))

    def letter(colour) -> str:
        if colour is None:
            return "."
        return ALPHABET[int(((centres - colour) ** 2).sum(-1).argmin())]

    encoded = []
    for f in frames:
        text = []
        for line in f:
            for cell in line:
                text.append("." if cell is None else table[cell[0]] + letter(cell[1]) + letter(cell[2]))
        encoded.append("".join(text))
    palette = ["#%02x%02x%02x" % tuple(int(round(v)) for v in np.clip(c, 0, 255)) for c in centres]
    sprite = {
        "style": style, "cols": cols, "rows": rows, "fps": FPS,
        "palette": palette, "alphabet": ALPHABET, "frames": encoded,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(sprite, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{out}: {cols} x {rows}, {sum(len(f) for f in encoded)} code points")


def preview(path: Path, n: int, out: Path) -> None:
    sprite = json.loads(path.read_text(encoding="utf-8"))
    style = sprite["style"]
    dx, dy = DOTS[style]
    pattern = {g: v for v, g in glyphs(style).items()}
    colour = {a: sprite["palette"][i] for i, a in enumerate(sprite["alphabet"])}
    px = 24  # a cell 24 x 48
    image = Image.new("RGB", (sprite["cols"] * px, sprite["rows"] * px * 2), "#ffffff")
    draw = ImageDraw.Draw(image)
    points = list(sprite["frames"][n])
    at = 0
    for r in range(sprite["rows"]):
        for c in range(sprite["cols"]):
            glyph = points[at]
            if glyph == ".":
                at += 1
                continue
            fg, bg = colour.get(points[at + 1]), colour.get(points[at + 2])
            at += 3
            bits = pattern.get(glyph, 0)
            for i in range(dx * dy):
                y, x = i // dx, i % dx
                w, h = px // dx, px * 2 // dy
                box = (c * px + x * w, r * px * 2 + y * h, c * px + (x + 1) * w - 1, r * px * 2 + (y + 1) * h - 1)
                fill = fg if bits & bit(style, y, x) else bg
                if fill:
                    draw.rectangle(box, fill=fill)
    image.save(out)


if __name__ == "__main__":
    if sys.argv[1] == "build":
        mod, style, rows = Path(sys.argv[2]), sys.argv[3], int(sys.argv[4])
        out = Path(sys.argv[5]) if len(sys.argv) > 5 else mod / "assets" / "sprites" / f"{style}-{rows}.json"
        build(mod, style, rows, out)
    else:
        preview(Path(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4]))
