"""Build the walking set of picture frames for one dancer height.

She walks a quarter of a text column at a time. Her picture box is one
column wider than she is, and each dance frame is saved four times, shifted
right by 0, 1/4, 2/4 and 3/4 of a column inside it; the mod moves the box a
whole column at a time and swaps the quarter in between. The stand, the thin
glowing disc she floats on away from the words, is one row of its own under
her feet, saved at the same four shifts.

A column is as wide as the plain frames make it at this height: the frames
in assets/png are 168 x 192 and fill round(height * 1.75) columns.

usage: python -I walk.py <mod dir> <height in rows> [out dir]
  writes <out dir or mod dir/assets/walk-<height>>/f0000-0.png ... and
  stand-0.png ... stand-3.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

FRAME_W, FRAME_H = 168, 192
FEET_X = 84  # where her feet stand, from the frames (median of feet spans)
SS = 8  # supersampling for the stand

mod = Path(sys.argv[1])
rows = int(sys.argv[2])
out = Path(sys.argv[3]) if len(sys.argv) > 3 else mod / "assets" / f"walk-{rows}"
out.mkdir(parents=True, exist_ok=True)

# Math.round in the mod: halves go up.
cols = int(np.floor(rows * 2 * 0.875 + 0.5))
col_px = FRAME_W / cols
canvas_w = round(FRAME_W + col_px)
row_px = round(FRAME_H / rows)
shifts = [round(q * col_px / 4) for q in range(4)]


def stand(dx: int) -> Image.Image:
    """The disc: a thin pale top, a pink rim under it, a soft glow below."""
    w, h = canvas_w * SS, row_px * SS
    cx = (FEET_X + dx) * SS
    rx, ry = 47 * SS, 2.6 * SS
    top_y = 3.0 * SS
    thick = 2.2 * SS

    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse((cx - rx * 0.95, top_y, cx + rx * 0.95, top_y + 9 * SS), fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(4 * SS))

    side = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(side)
    d.ellipse((cx - rx, top_y - ry + thick, cx + rx, top_y + ry + thick), fill=255)
    d.rectangle((cx - rx, top_y, cx + rx, top_y + thick), fill=255)

    face = Image.new("L", (w, h), 0)
    ImageDraw.Draw(face).ellipse((cx - rx, top_y - ry, cx + rx, top_y + ry), fill=255)

    edge = Image.new("L", (w, h), 0)
    ImageDraw.Draw(edge).ellipse((cx - rx, top_y - ry, cx + rx, top_y + ry), outline=255, width=int(0.7 * SS))

    def layer(mask: Image.Image, rgb: tuple[int, int, int]) -> np.ndarray:
        a = np.asarray(mask, np.float32) / 255
        return np.dstack([np.broadcast_to(np.float32(c), a.shape) for c in rgb] + [a])

    def over(top: np.ndarray, under: np.ndarray) -> np.ndarray:
        a = top[..., 3:] + under[..., 3:] * (1 - top[..., 3:])
        rgb = (top[..., :3] * top[..., 3:] + under[..., :3] * under[..., 3:] * (1 - top[..., 3:])) / np.maximum(a, 1e-6)
        return np.concatenate([rgb, a], -1)

    # The face fades from white at the back to a blush at the front.
    y = np.arange(h, dtype=np.float32)[:, None]
    t = np.clip((y - (top_y - ry)) / (2 * ry), 0, 1)
    face_rgb = np.empty((h, w, 3), np.float32)
    face_rgb[..., 0] = 255
    face_rgb[..., 1] = 246 - 22 * t
    face_rgb[..., 2] = 250 - 14 * t
    face_layer = np.concatenate([face_rgb, (np.asarray(face, np.float32) / 255)[..., None]], -1)

    img = layer(glow, (255, 140, 200))
    img = over(layer(side, (214, 120, 168)), img)
    img = over(face_layer, img)
    img = over(layer(edge, (246, 214, 160)), img)
    rgba = np.concatenate([img[..., :3], img[..., 3:] * 255], -1).clip(0, 255).astype(np.uint8)
    # Downsample premultiplied so the edges do not darken.
    pre = Image.fromarray(rgba, "RGBA").convert("RGBa").resize((canvas_w, row_px), Image.LANCZOS)
    return pre.convert("RGBA")


for q, dx in enumerate(shifts):
    stand(dx).save(out / f"stand-{q}.png", optimize=True)

frames = sorted((mod / "assets" / "png").glob("f*.png"))
for path in frames:
    girl = Image.open(path).convert("RGBA")
    for q, dx in enumerate(shifts):
        canvas = Image.new("RGBA", (canvas_w, FRAME_H), (0, 0, 0, 0))
        canvas.paste(girl, (dx, 0))
        canvas.save(out / f"{path.stem}-{q}.png", optimize=True)

print(f"height {rows}: {cols}+1 columns, {canvas_w}x{FRAME_H}, stand {canvas_w}x{row_px}, shifts {shifts}, {len(frames)} frames")
