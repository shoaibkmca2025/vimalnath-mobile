"""Drawn tiles for the Telescopic Sliding, Synchronized System and Sliding Folding configurations.

Writes assets/images/telescopic/tile-01..08.jpg, assets/images/synchronized/tile-01..06.jpg and
assets/images/folding/tile-02..10.jpg (folding tiles are numbered by door count).
Flat illustration: navy frame, light blue glass with a diagonal glare, handles and an F on each
fixed panel. One panel per sliding or fixed leaf, so "2+1" draws 3 panels. Proportions are measured
from the approved reference art (a 410 x 290 px frame) and scaled to fill the square tile.

  Telescopic:   fixed panels on the left, one handle on the last panel.
  Synchronized: opens from the centre, so a pair of handles meets in the middle and the fixed
                panels are split between the two ends.
  Folding:      one handle on the last panel, and a zigzag fold line under the frame with a hinge
                dot on each stile and mullion. The frame ends higher to leave room for it.
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONT = os.path.join(ROOT, 'node_modules', '@expo-google-fonts', 'dm-sans', '700Bold', 'DMSans_700Bold.ttf')

# Same order as the configuration lists in src/data/cutlist.ts. Folding entries are door counts.
SYSTEMS = {
    'telescopic': ['1+0', '1+1', '2+0', '2+1', '3+0', '3+1', '4+0', '4+1'],
    'synchronized': ['2+0', '2+2', '4+0', '4+2', '6+0', '6+2'],
    'folding': ['2', '3', '4', '5', '6', '7', '8', '9', '10'],
}

SIZE = 900
SUPERSAMPLE = 4  # drawn large, then downsampled for smooth edges

FRAME = (21, 35, 71)
GLASS = (213, 229, 255)
GLARE = (234, 242, 255)
SKY_TOP = (225, 236, 254)
SKY_BOTTOM = (207, 220, 255)
FLOOR = (211, 223, 247)

# Reference measurements, in pixels of the 410 px wide reference frame.
REF_FRAME_WIDTH = 410
REF_STILE, REF_TOP_RAIL, REF_BOTTOM_RAIL, REF_MULLION = 14, 20, 6, 11
REF_HANDLE_WIDTH, REF_HANDLE_HEIGHT, REF_HANDLE_GAP = 5, 45, 5
HANDLE_CENTER = 0.54  # of the frame height

# Glare band as fractions of each pane's width: (left, right) at the top and at the bottom.
GLARE_TOP = (0.20, 0.46)
GLARE_BOTTOM = (0.005, 0.235)

# The F on fixed panels; it shrinks to fit narrow panes.
LABEL_SIZE = 130
LABEL_MAX_PANE_RATIO = 1.1

MARGIN_X = 72
FRAME_TOP = 54
FLOOR_TOP = 840

# Fold line, measured from the earlier folding art: blue zigzag with navy hinge dots.
FOLD_FLOOR_TOP = 740
FOLD_LINE = (36, 88, 232)
FOLD_LINE_WIDTH = 11
FOLD_DOT_DIAMETER = 23
FOLD_HEIGHT = 46


def layout(system, configuration):
    """Panel count, indexes of the fixed panels, and handles as (panel index, edge)."""
    parts = [int(part) for part in configuration.split('+')]
    sliding, fixed = parts[0], (parts[1] if len(parts) > 1 else 0)
    panels = sliding + fixed
    if system == 'synchronized':
        middle = panels // 2
        fixed_panels = set(range(fixed // 2)) | set(range(panels - fixed // 2, panels))
        return panels, fixed_panels, [(middle - 1, 'right'), (middle, 'left')]
    return panels, set(range(fixed)), [(panels - 1, 'right')]


def draw_tile(panels, fixed_panels, handles, fold=False):
    s = SUPERSAMPLE
    size = SIZE * s
    floor_top = (FOLD_FLOOR_TOP if fold else FLOOR_TOP) * s
    image = Image.new('RGB', (size, size), FLOOR)
    draw = ImageDraw.Draw(image)

    for y in range(floor_top):
        t = y / (floor_top - 1)
        draw.line([(0, y), (size, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(SKY_TOP, SKY_BOTTOM)))

    left, right = MARGIN_X * s, (SIZE - MARGIN_X) * s
    top, bottom = FRAME_TOP * s, floor_top
    k = (right - left) / REF_FRAME_WIDTH
    stile, top_rail, bottom_rail, mullion = (round(v * k) for v in (REF_STILE, REF_TOP_RAIL, REF_BOTTOM_RAIL, REF_MULLION))

    draw.rectangle([left, top, right - 1, bottom - 1], fill=FRAME)

    glass_top, glass_bottom = top + top_rail, bottom - bottom_rail
    inner_left, inner_right = left + stile, right - stile
    pane_width = (inner_right - inner_left - (panels - 1) * mullion) / panels
    pane_left = lambda index: inner_left + index * (pane_width + mullion)
    font = ImageFont.truetype(FONT, round(min(LABEL_SIZE * s, pane_width * LABEL_MAX_PANE_RATIO)))

    for index in range(panels):
        x0 = pane_left(index)
        x1 = x0 + pane_width
        draw.rectangle([round(x0), glass_top, round(x1) - 1, glass_bottom - 1], fill=GLASS)
        draw.polygon(
            [
                (x0 + GLARE_TOP[0] * pane_width, glass_top),
                (x0 + GLARE_TOP[1] * pane_width, glass_top),
                (x0 + GLARE_BOTTOM[1] * pane_width, glass_bottom),
                (x0 + GLARE_BOTTOM[0] * pane_width, glass_bottom),
            ],
            fill=GLARE,
        )
        if index in fixed_panels:
            draw.text(((x0 + x1) / 2, (glass_top + glass_bottom) / 2), 'F', font=font, fill=FRAME, anchor='mm')

    handle_width, handle_height, gap = REF_HANDLE_WIDTH * k, REF_HANDLE_HEIGHT * k, REF_HANDLE_GAP * k
    handle_center = top + (bottom - top) * HANDLE_CENTER
    for index, edge in handles:
        x = pane_left(index) + pane_width - gap - handle_width if edge == 'right' else pane_left(index) + gap
        draw.rounded_rectangle(
            [x, handle_center - handle_height / 2, x + handle_width, handle_center + handle_height / 2],
            radius=handle_width / 2,
            fill=FRAME,
        )

    if fold:
        # One hinge per stile and mullion, alternating low/high, centred in the floor band.
        center = (floor_top + size) / 2
        hinges = [left + stile / 2] + [pane_left(index) - mullion / 2 for index in range(1, panels)] + [right - stile / 2]
        points = [(x, center + (FOLD_HEIGHT / 2 if index % 2 == 0 else -FOLD_HEIGHT / 2) * s) for index, x in enumerate(hinges)]
        draw.line(points, fill=FOLD_LINE, width=FOLD_LINE_WIDTH * s, joint='curve')
        radius = FOLD_DOT_DIAMETER * s / 2
        for x, y in points:
            draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=FRAME)

    return image.resize((SIZE, SIZE), Image.LANCZOS)


for system, configurations in SYSTEMS.items():
    for index, configuration in enumerate(configurations, start=1):
        panels, fixed_panels, handles = layout(system, configuration)
        number = panels if system == 'folding' else index
        path = os.path.join(ROOT, 'assets', 'images', system, f'tile-{number:02d}.jpg')
        draw_tile(panels, fixed_panels, handles, fold=system == 'folding').save(path, quality=92, optimize=True)
        print('ok', system, os.path.basename(path), configuration, panels, 'panels')
