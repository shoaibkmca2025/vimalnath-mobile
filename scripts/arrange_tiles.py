"""Re-lay the Cutlist configuration diagrams so every tile matches: same frame width, centred, even margins.

Each tile is a drawn window frame (opaque, cut out as a rectangle) plus, for folding systems, a zigzag
track below it (masked from the background by colour). Both are placed on a fresh gradient.
Run from the repo root: python scripts/arrange_tiles.py
"""
import glob

import numpy as np
from PIL import Image

SIZE = 900
FRAME_WIDTH = 640  # every frame gets this width, so tiles line up across the grid
TOP, BOTTOM = np.array([228, 238, 255]), np.array([212, 224, 248])


def background():
    t = np.linspace(0, 1, SIZE)[:, None, None]
    return np.broadcast_to(TOP * (1 - t) + BOTTOM * t, (SIZE, SIZE, 3)).astype(np.float32)


def frame_rect(rgb):
    dark = rgb.sum(axis=2) < 250
    rows = np.where(dark.mean(axis=1) > 0.4)[0]
    top, bottom = rows.min(), rows.max()
    cols = np.where(dark[top : bottom + 1].mean(axis=0) > 0.4)[0]
    return top, bottom, cols.min(), cols.max()


def arrange(path):
    src = Image.open(path).convert("RGB")
    rgb = np.asarray(src).astype(np.float32)
    top, bottom, left, right = frame_rect(rgb)

    # Everything that isn't frame: masked against each row's own background colour (the left edge).
    row_bg = rgb[:, 4:5, :]
    alpha = np.clip((np.abs(rgb - row_bg).sum(axis=2) - 40) / 60, 0, 1)
    alpha[top : bottom + 1, left : right + 1] = 1  # the frame, glass included, is opaque
    alpha[:, :8] = alpha[:, -8:] = 0
    alpha[:8] = alpha[-8:] = 0
    ys, xs = np.where(alpha > 0.5)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)

    scale = FRAME_WIDTH / (right - left + 1)
    content = src.crop(box)
    mask = Image.fromarray((alpha * 255).astype(np.uint8)).crop(box)
    size = (round(content.width * scale), round(content.height * scale))
    content = content.resize(size, Image.LANCZOS)
    mask = mask.resize(size, Image.LANCZOS)

    out = Image.fromarray(background().astype(np.uint8))
    out.paste(content, ((SIZE - size[0]) // 2, (SIZE - size[1]) // 2), mask)
    out.save(path, quality=92, subsampling=0)
    return size


if __name__ == "__main__":
    for folder in ("telescopic", "synchronized", "folding"):
        for path in sorted(glob.glob(f"assets/images/{folder}/config-*.jpg")):
            if Image.open(path).size != (SIZE, SIZE):
                continue  # unused photo tiles
            print(path, arrange(path))
