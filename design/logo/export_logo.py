"""Export the NeuroVault hypercube logo: lit from the upper left, two shades per face, the accent cube inside.

Same geometry and shading as design/logo-options.html (markSvg, "Lit from upper left", Inside: Accent inside),
so the files match the page. Writes, next to this script:
  hypercube-mark.svg        the bare mark, coloured through CSS variables (any theme and accent)
  hypercube-tile.svg        the flat tile, coloured through the same CSS variables (window and taskbar icon, 32 px and up)
  hypercube-tile-small.svg  the bold tile for 16, 24 and 32 px (QC 74: the cube fills its square, the inner cube is bigger)
  hypercube-tile-<n>.png    n = 16 24 32 48 64 128 256, in Soft Slate + Sand (static fallback; bold up to 32 px; needs Pillow)
  neurovault.ico            16 24 32 (bold) 48 256 (regular), Soft Slate + Sand (needs Pillow)
  hypercube-icon.svg        the window and taskbar icon (QC 78): the bold cube alone, no tile, filling the square, same variables
  hypercube-icon-<n>.png    n = 16 20 24 32 40 48 64 256, Soft Slate + Sand on transparent (static fallback; needs Pillow)
  neurovault.ico            every size from the icon drawing above (needs Pillow)
This replaces Build N's design/logo/export_small.py (staging), which drew the bold tile from the earlier inside light.

Run:  python export_logo.py                        (SVGs only, standard library)
      <python with Pillow> export_logo.py --png    (also the PNGs and the .ico)
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# The user's look (frontend/js/accents.js, tokens.css): Soft Slate page and text, Sand accent
SLATE = {'bg': '#1e2024', 'fg': '#ece5d8', 'acc': '#d9b97a'}

R1, R2 = 9.75, 4.6
ANG = (-90, -30, 30, 90, 150, 210)
FACES = [  # screen frame: x right, y up, z toward you; each face split in two along its ridge from the centre
    {'n': (0, .816, .577), 'halves': ((-150, -90), (-90, -30))},   # top
    {'n': (.707, -.408, .577), 'halves': ((-30, 30), (30, 90))},   # right
    {'n': (-.707, -.408, .577), 'halves': ((90, 150), (150, 210))},  # left
]
LIGHT = (135, 35)  # upper left: angle on screen (90 = from above) and elevation, in degrees
# the two tile drawings: regular (48 px and up, and the bare mark), bold (16, 24 and 32 px; Build N's QC 74 proportions:
# the cube's corners 0.6 px from the tile's edge, a bigger inner cube)
STYLE = {'regular': {'sc': .70, 'r2': R2, 'lw': .7}, 'bold': {'sc': 11.4 / R1, 'r2': 5.5, 'lw': .8}}
# The icon (QC 78, "windows task bar icon still tiny"): no tile, the bold cube alone filling the square. A thin rim in the
# theme's background colour keeps its outline on a taskbar of the opposite brightness. The hexagon plus its rim spans 23.5 of 24.
ICON_RIM = .9
ICON = {'sc': (23.5 - ICON_RIM) / (2 * R1), 'r2': 5.5, 'lw': .8}
ICON_SIZES = (16, 20, 24, 32, 40, 48, 64, 256)


def V(r, a):
    a = math.radians(a)
    return (12 + r * math.cos(a), 12 + r * math.sin(a))


def norm(v):
    l = math.sqrt(sum(x * x for x in v))
    return tuple(x / l for x in v)


def round_half_up(x):  # Math.round in JS
    return int(math.floor(x + .5))


def mix(a, b, t):
    A = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    B = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f"{round_half_up(v + (w - v) * t):02x}" for v, w in zip(A, B))


def P(pts):
    return 'M' + 'L'.join(f"{x:.2f} {y:.2f}" for x, y in pts) + 'Z'


def facets(r):
    """Six triangles of one cube; each half-face's normal tilts toward its own side (two shades per face)."""
    out = []
    for f in FACES:
        h0, h1 = f['halves']
        allp = [(12, 12), V(r, h0[0]), V(r, h0[1]), V(r, h1[1])]
        for a0, a1 in f['halves']:
            pts = [(12, 12), V(r, a0), V(r, a1)]
            cx = sum(p[0] for p in pts) / 3 - sum(p[0] for p in allp) / 4
            cy = sum(p[1] for p in pts) / 3 - sum(p[1] for p in allp) / 4
            off = norm((cx, -cy, 0))
            out.append({'pts': pts, 'n': norm(tuple(v + .55 * o for v, o in zip(f['n'], off)))})
    return out


def shapes(r2=R2):
    """The mark as (role, points, t): t is how lit the facet is, 0 (least) to 1 (most), across both cubes.
    Roles: 'ink' the big cube (theme text colour), 'accent' the small cube."""
    ph, el = (math.radians(x) for x in LIGHT)
    L = (math.cos(ph) * math.cos(el), math.sin(ph) * math.cos(el), math.sin(el))
    out = [('ink', f) for f in facets(R1)] + [('accent', f) for f in facets(r2)]
    b = [max(0, sum(x * y for x, y in zip(f['n'], L))) for _, f in out]
    lo, hi = min(b), max(b)
    return [(role, f['pts'], (bi - lo) / (hi - lo) if hi > lo else 1) for (role, f), bi in zip(out, b)]


def conn(r2=R2):  # the six corner-to-corner lines
    return ''.join(f"M{V(r2, a)[0]:.2f} {V(r2, a)[1]:.2f}L{V(R1, a)[0]:.2f} {V(R1, a)[1]:.2f}" for a in ANG)


# How far each facet is pulled toward the background: dark themes darken the less-lit facets, light themes pale the most-lit ones
def to_bg(t, light_theme):
    return t * .55 if light_theme else (1 - t) * .62


def fill_hex(role, t, c):
    light = int(c['bg'][1:3], 16) > 128
    return mix(c['fg'] if role == 'ink' else c['acc'], c['bg'], to_bg(t, light))


def css_parts(line_var, line_w, r2=R2):
    """Each facet is its colour, then the background laid over it at the facet's opacity (the same as mixing the two),
    so one file follows any theme and accent through CSS variables. The corner lines are cut in the surface colour."""
    var = {'ink': f"var(--logo-ink, {SLATE['fg']})", 'accent': f"var(--logo-accent, {SLATE['acc']})"}
    bg = f"var(--logo-bg, {SLATE['bg']})"
    parts = []
    for role, pts, t in shapes(r2):
        d = P(pts)
        dk, lt = to_bg(t, False), to_bg(t, True)
        parts.append(f'<path d="{d}" style="fill:{var[role]}"/>')
        parts.append(f'<path d="{d}" style="fill:{bg};fill-opacity:calc({dk:.3f} + {lt - dk:.3f} * var(--logo-light-theme, 0))"/>')
    parts.append(f'<path d="{conn(r2)}" style="fill:none;stroke:{line_var};stroke-width:{line_w};stroke-linecap:round"/>')
    return '\n'.join(parts)


VARS_DESC = ('Colours come from CSS variables: --logo-ink (big cube, the theme text colour), --logo-accent (small cube),\n'
             '--logo-bg (the theme background), --logo-tile (the tile, a step from the background toward the text colour),\n'
             '--logo-light-theme (0 dark, 1 light). logo-vars.js makes them from a theme and accent. Without them it draws in Soft Slate and Sand.')
TILE_FALLBACK = mix(SLATE['bg'], SLATE['fg'], .12)


def mark_css_svg():
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="NeuroVault">\n'
            '<title>NeuroVault</title>\n'
            f'<desc>NeuroVault hypercube, lit from the upper left. {VARS_DESC}</desc>\n'
            + css_parts(f"var(--logo-bg, {SLATE['bg']})", .7) + '\n</svg>\n')


def tile_css_svg(style='regular'):
    """The flat tile, driven by the same variables, in one of the two drawings (STYLE)."""
    st = STYLE[style]
    sc, small = st['sc'], style == 'bold'
    off = 12 * (1 - sc)
    tile = f"var(--logo-tile, {TILE_FALLBACK})"
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="NeuroVault">\n'
            '<title>NeuroVault</title>\n'
            f'<desc>NeuroVault tile{" for 16, 24 and 32 px (bold: the cube fills its square)" if small else ""}, lit from the upper left. {VARS_DESC}</desc>\n'
            f'<rect width="24" height="24" rx="5.5" style="fill:{tile}"/>\n'
            f'<g transform="translate({off:.3f} {off:.3f}) scale({sc:.4f})">\n' + css_parts(tile, st['lw'], st['r2']) + '\n</g>\n</svg>\n')


def icon_css_svg():
    """The window and taskbar icon: the bold cube alone on transparent, themed by the same variables."""
    sc = ICON['sc']
    off = 12 * (1 - sc)
    bg = f"var(--logo-bg, {SLATE['bg']})"
    hexagon = P([V(R1, a) for a in ANG])
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" role="img" aria-label="NeuroVault">\n'
            '<title>NeuroVault</title>\n'
            f'<desc>NeuroVault window and taskbar icon: the cube alone, filling its square, lit from the upper left. {VARS_DESC}</desc>\n'
            f'<g transform="translate({off:.3f} {off:.3f}) scale({sc:.4f})">\n' + css_parts(bg, ICON['lw'], ICON['r2']) + '\n'
            f'<path d="{hexagon}" style="fill:none;stroke:{bg};stroke-width:{ICON_RIM / sc:.3f};stroke-linejoin:round"/>\n'
            '</g>\n</svg>\n')


def icon_png(size, c=SLATE, ss=16):
    """The icon with Pillow, on transparent: shapes at ss times the size, then scaled down."""
    from PIL import Image, ImageDraw
    sc, lw, r2 = ICON['sc'], ICON['lw'], ICON['r2']
    off = 12 * (1 - sc)
    W = size * ss
    k = W / 24
    hexrgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    bg = hexrgb(c['bg'])
    tr = lambda p: ((off + sc * p[0]) * k, (off + sc * p[1]) * k)
    im = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    for role, pts, t in shapes(r2):
        dr.polygon([tr(p) for p in pts], fill=hexrgb(fill_hex(role, t, c)))

    def stroke(p, q, w):   # a round-capped line
        dr.line([p, q], fill=bg, width=max(1, round(w)))
        for x, y in (p, q):
            dr.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=bg)
    for a in ANG:
        stroke(tr(V(r2, a)), tr(V(R1, a)), lw * sc * k)
    corners = [tr(V(R1, a)) for a in ANG]
    for i in range(6):
        stroke(corners[i], corners[(i + 1) % 6], ICON_RIM * k)
    return im.resize((size, size), Image.BOX)   # area average: no ringing halo on the transparent background


def tile_png(size, c=SLATE, ss=16, style=None):
    """Draw the tile with Pillow: shapes at ss times the size, then scaled down (smooth edges, no SVG renderer needed).
    Up to 32 px it uses the bold drawing, like hypercube-tile-small.svg."""
    from PIL import Image, ImageDraw
    st = STYLE[style or ('bold' if size <= 32 else 'regular')]
    sc, lw, r2 = st['sc'], st['lw'], st['r2']
    off = 12 * (1 - sc)
    W = size * ss
    k = W / 24
    hexrgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    tile = hexrgb(mix(c['bg'], c['fg'], .12))
    tr = lambda p: ((off + sc * p[0]) * k, (off + sc * p[1]) * k)
    im = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    dr.rounded_rectangle([0, 0, W - 1, W - 1], radius=5.5 * k, fill=tile)
    for role, pts, t in shapes(r2):
        dr.polygon([tr(p) for p in pts], fill=hexrgb(fill_hex(role, t, c)))
    w = lw * sc * k   # the corner lines, round-capped, in the tile colour
    for a in ANG:
        p, q = tr(V(r2, a)), tr(V(R1, a))
        dr.line([p, q], fill=tile, width=max(1, round(w)))
        for x, y in (p, q):
            dr.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=tile)
    return im.resize((size, size), Image.LANCZOS)


def main():
    for name, text in (('hypercube-mark.svg', mark_css_svg()), ('hypercube-tile.svg', tile_css_svg()),
                       ('hypercube-tile-small.svg', tile_css_svg('bold')), ('hypercube-icon.svg', icon_css_svg())):
        with open(os.path.join(HERE, name), 'w', encoding='utf-8', newline='\n') as f:
            f.write(text)
    if '--png' in sys.argv:
        imgs = {}
        for n in (16, 24, 32, 48, 64, 128, 256):
            imgs[n] = tile_png(n)
            imgs[n].save(os.path.join(HERE, f'hypercube-tile-{n}.png'))
        icons = {n: icon_png(n) for n in ICON_SIZES}
        for n, im in icons.items():
            im.save(os.path.join(HERE, f'hypercube-icon-{n}.png'))
        # QC 78: the .ico is the icon drawing at every size (no tile)
        icons[256].save(os.path.join(HERE, 'neurovault.ico'), format='ICO', sizes=[(n, n) for n in ICON_SIZES],
                        append_images=[icons[n] for n in ICON_SIZES if n != 256])
    print('written to', HERE)


if __name__ == '__main__':
    main()
