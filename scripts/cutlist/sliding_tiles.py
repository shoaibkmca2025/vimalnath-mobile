"""Drawn tiles for the Telescopic Sliding and Synchronized System configurations.

Writes assets/images/telescopic/tile-01..08.jpg and assets/images/synchronized/tile-01..06.jpg.
Flat illustration: navy frame, light blue glass with a diagonal glare, handles and an F on each
fixed panel. One panel per sliding or fixed leaf, so "2+1" draws 3 panels. Proportions are measured
from the approved reference art (a 410 x 290 px frame) and scaled to fill the square tile.

  Telescopic:   fixed panels on the left, one handle on the last panel.
  Synchronized: opens from the centre, so a pair of handles meets in the middle and the fixed
                panels are split between the two ends.
"""
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONT = os.path.join(ROOT, 'node_modules', '@expo-google-fonts', 'dm-sans', '700Bold', 'DMSans_700Bold.ttf')

# Same order as the configuration lists in src/data/cutlist.ts.
SYSTEMS = {
    'telescopic': ['1+0', '1+1', '2+0', '2+1', '3+0', '3+1', '4+0', '4+1'],
    'synchronized': ['2+0', '2+2', '4+0', '4+2', '6+0', '6+2'],
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


def layout(system, configuration):
    """Panel count, indexes of the fixed panels, and handles as (panel index, edge)."""
    sliding, fixed = (int(part) for part in configuration.split('+'))
    panels = sliding + fixed
    if system == 'synchronized':
        middle = panels // 2
        fixed_panels = set(range(fixed // 2)) | set(range(panels - fixed // 2, panels))
        return panels, fixed_panels, [(middle - 1, 'right'), (middle, 'left')]
    return panels, set(range(fixed)), [(panels - 1, 'right')]


def draw_tile(panels, fixed_panels, handles):
    s = SUPERSAMPLE
    size = SIZE * s
    image = Image.new('RGB', (size, size), FLOOR)
    draw = ImageDraw.Draw(image)

    for y in range(FLOOR_TOP * s):
        t = y / (FLOOR_TOP * s - 1)
        draw.line([(0, y), (size, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(SKY_TOP, SKY_BOTTOM)))

    left, right = MARGIN_X * s, (SIZE - MARGIN_X) * s
    top, bottom = FRAME_TOP * s, FLOOR_TOP * s
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

    return image.resize((SIZE, SIZE), Image.LANCZOS)


for system, configurations in SYSTEMS.items():
    for number, configuration in enumerate(configurations, start=1):
        panels, fixed_panels, handles = layout(system, configuration)
        path = os.path.join(ROOT, 'assets', 'images', system, f'tile-{number:02d}.jpg')
        draw_tile(panels, fixed_panels, handles).save(path, quality=92, optimize=True)
        print('ok', system, os.path.basename(path), configuration, panels, 'panels')
