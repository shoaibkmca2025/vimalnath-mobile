"""Draw the Sliding Folding tiles for the Cutlist (2 to 10 doors).

Each tile shows the doors in elevation, part-folded like an accordion so the door count reads at a
glance, and the plan view of the fold below. Same palette, background and 640 px frame width as the
Telescopic and Synchronized tiles (see arrange_tiles.py). Drawn at 3x and downsampled for clean edges.
Run from the repo root: python scripts/draw_folding_tiles.py
"""
from PIL import Image, ImageDraw

SIZE = 900
S = 3  # supersampling
NAVY = (21, 35, 70)
GLASS_FRONT = (213, 229, 255)
GLASS_BACK = (190, 210, 246)
SHINE = (236, 243, 255)
BLUE = (37, 99, 235)
TOP, BOTTOM = (228, 238, 255), (212, 224, 248)

FRAME = (130, 150, 770, 600)  # outer frame, 640 wide
BAR = 14  # frame thickness
FOLD = 26  # how far the back hinges recede, top and bottom
PLAN_Y = 700  # centre line of the plan view
PLAN_DEPTH = 34


def px(*values):
    return [round(v * S) for v in values]


def background():
    img = Image.new("RGB", (SIZE * S, SIZE * S))
    draw = ImageDraw.Draw(img)
    for y in range(SIZE * S):
        t = y / (SIZE * S - 1)
        draw.line([(0, y), (SIZE * S, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)))
    return img


def draw_tile(doors):
    img = background()
    draw = ImageDraw.Draw(img)
    left, top, right, bottom = FRAME
    inner = (left + BAR, top + BAR, right - BAR, bottom - BAR)
    width = (inner[2] - inner[0]) / doors
    edges = [inner[0] + width * i for i in range(doors + 1)]
    # Front hinges on even edges, back hinges on odd ones: the accordion recedes at every other edge.
    # The last door always closes flat against the jamb, whatever the door count.
    inset = [FOLD if i % 2 and i != doors else 0 for i in range(doors + 1)]

    # Head track and sill, then the side jambs.
    draw.rectangle(px(left, top, right, top + BAR), fill=NAVY)
    draw.rectangle(px(left, bottom - BAR, right, bottom), fill=NAVY)
    draw.rectangle(px(left, top, left + BAR, bottom), fill=NAVY)
    draw.rectangle(px(right - BAR, top, right, bottom), fill=NAVY)

    for i in range(doors):
        x0, x1 = edges[i], edges[i + 1]
        quad = [(x0, inner[1] + inset[i]), (x1, inner[1] + inset[i + 1]), (x1, inner[3] - inset[i + 1]), (x0, inner[3] - inset[i])]
        facing_front = i % 2 == 0
        draw.polygon([tuple(px(*point)) for point in quad], fill=GLASS_FRONT if facing_front else GLASS_BACK)
        # A soft diagonal reflection on each pane.
        a = x0 + (x1 - x0) * 0.18
        b = x0 + (x1 - x0) * 0.34
        shine = [(a + 10, quad[0][1] + (quad[1][1] - quad[0][1]) * 0.18 + 10), (b + 10, quad[0][1] + (quad[1][1] - quad[0][1]) * 0.34 + 10),
                 (b - 8, quad[3][1] - 14), (a - 8, quad[3][1] - 14)]
        draw.polygon([tuple(px(*point)) for point in shine], fill=SHINE if facing_front else GLASS_FRONT)
        # Pane outline, top and bottom rails.
        draw.line([tuple(px(*quad[0])), tuple(px(*quad[1]))], fill=NAVY, width=6 * S)
        draw.line([tuple(px(*quad[3])), tuple(px(*quad[2]))], fill=NAVY, width=6 * S)

    # Stiles: heavier on the front hinges, lighter on the back ones.
    for i, x in enumerate(edges):
        if i in (0, doors):
            continue
        y0, y1 = inner[1] + inset[i], inner[3] - inset[i]
        draw.line(px(x, y0, x, y1), fill=NAVY, width=(9 if inset[i] == 0 else 6) * S)
        # Hinge knuckles.
        for y in (y0 + (y1 - y0) * 0.14, y0 + (y1 - y0) * 0.5, y0 + (y1 - y0) * 0.86):
            draw.rounded_rectangle(px(x - 6, y - 11, x + 6, y + 11), radius=4 * S, fill=NAVY)

    # Handle on the last door.
    hx = edges[-1] - min(26, width * 0.28)
    hy = (inner[1] + inner[3]) / 2
    draw.rounded_rectangle(px(hx - 5, hy - 38, hx + 5, hy + 38), radius=5 * S, fill=NAVY)

    # Plan view: the doors as a zigzag between the jambs, hinges as dots.
    points = [(left + (right - left) * i / doors, PLAN_Y + (PLAN_DEPTH / 2 if i % 2 == 0 else -PLAN_DEPTH / 2)) for i in range(doors + 1)]
    draw.line(px(left, PLAN_Y + PLAN_DEPTH / 2 + 26, right, PLAN_Y + PLAN_DEPTH / 2 + 26), fill=(170, 190, 228), width=4 * S)
    draw.line([tuple(px(*point)) for point in points], fill=BLUE, width=8 * S, joint="curve")
    for x, y in points:
        draw.ellipse(px(x - 11, y - 11, x + 11, y + 11), fill=NAVY)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


if __name__ == "__main__":
    for doors in range(2, 11):
        path = f"assets/images/folding/config-{doors:02d}.jpg"
        draw_tile(doors).save(path, quality=92, subsampling=0)
        print(path)
