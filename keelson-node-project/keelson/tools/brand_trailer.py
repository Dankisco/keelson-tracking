"""Paint the Keelson logo onto the trailer in the hero photograph.

    python tools/brand_trailer.py

Reads  public/img/freight-land.webp   (the untouched photo)
Writes public/img/freight-land.webp   (branded)
       public/img/_freight-land-original.webp  (kept once, as the backup)

The logo is applied as a MULTIPLY blend inside a perspective quad matched to
the trailer's side panel, so the corrugation ribs and the sunset shading show
through it the way real vinyl livery would.

To move or resize the logo, edit QUAD. The four points are pixel coordinates
in the 1080x718 source photo, clockwise from the top-left corner of the
panel the logo should sit in.
"""
import os
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(BASE, "public", "img", "freight-land.webp")
BACKUP = os.path.join(BASE, "public", "img", "_freight-land-original.webp")
FONT_PATH = os.environ.get("KEELSON_FONT", os.path.join(BASE, "tools", "Archivo.ttf"))

# Brand
INK = (28, 28, 28)
ORANGE = (240, 129, 34)

# The patch of trailer the logo sits in, measured off the photo. Clockwise
# from top-left. The trailer's rear edge is at about x=828, so the right-hand
# points stop short of it.
QUAD = [(625, 389), (800, 407), (800, 434), (625, 425)]

# How much of that patch's height the artwork fills.
FILL = 0.80

SS = 4            # supersampling factor for the composite
INK_ALPHA = 0.94  # a touch under 1 so the metal reads through


def solve(matrix, rhs):
    """Gaussian elimination with partial pivoting."""
    n = len(rhs)
    m = [row[:] + [rhs[i]] for i, row in enumerate(matrix)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-12:
            raise ValueError("degenerate quad")
        m[col], m[piv] = m[piv], m[col]
        pv = m[col][col]
        for r in range(n):
            if r == col:
                continue
            f = m[r][col] / pv
            for c in range(col, n + 1):
                m[r][c] -= f * m[col][c]
    return [m[i][n] / m[i][i] for i in range(n)]


def perspective_coeffs(dst, src):
    """Coefficients for Image.transform: output quad `dst` <- input rect `src`."""
    matrix, rhs = [], []
    for (X, Y), (u, v) in zip(dst, src):
        matrix.append([X, Y, 1, 0, 0, 0, -u * X, -u * Y])
        rhs.append(u)
        matrix.append([0, 0, 0, X, Y, 1, -v * X, -v * Y])
        rhs.append(v)
    return solve(matrix, rhs)


def build_logo(height):
    """The mark and wordmark, ink on transparent, trimmed to its own bounds."""
    logo = Image.new("RGBA", (height * 14, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(logo)

    try:
        font = ImageFont.truetype(FONT_PATH, int(height * 0.62))
        try:
            font.set_variation_by_axes([760, 108])  # weight, width
        except Exception:
            pass
    except OSError:
        font = ImageFont.truetype("arialbd.ttf", int(height * 0.62))

    # --- the mark: a spine with ribs, and the position dot ----------------
    mh = height * 0.74
    cy = height / 2
    x0 = height * 0.10
    spine_len = mh * 1.02
    lw = max(2, int(mh * 0.085))

    d.line([(x0, cy), (x0 + spine_len, cy)], fill=INK + (255,), width=int(lw * 1.25))
    rib_x = [x0 + spine_len * f for f in (0.20, 0.42, 0.64, 0.86)]
    rib_h = [mh * 0.40, mh * 0.62, mh * 0.62, mh * 0.40]
    for rx, rh in zip(rib_x, rib_h):
        d.line([(rx, cy - rh / 2), (rx, cy + rh / 2)], fill=INK + (215,), width=lw)

    dot_r = mh * 0.135
    dot_cx = x0 + spine_len + dot_r * 1.75
    d.ellipse([dot_cx - dot_r, cy - dot_r, dot_cx + dot_r, cy + dot_r],
              fill=ORANGE + (255,))

    # --- the wordmark, letterspaced by hand -------------------------------
    text = "KEELSON"
    tracking = height * 0.085
    pen = dot_cx + dot_r + height * 0.34
    for ch in text:
        d.text((pen, cy), ch, font=font, fill=INK + (255,), anchor="lm")
        pen += d.textlength(ch, font=font) + tracking

    return logo.crop(logo.getbbox())


def fit_to_quad(logo, quad):
    """Pad the logo onto a canvas shaped like the quad, so mapping the canvas
    onto it scales the artwork instead of stretching it."""
    w = (abs(quad[1][0] - quad[0][0]) + abs(quad[2][0] - quad[3][0])) / 2.0
    h = (abs(quad[3][1] - quad[0][1]) + abs(quad[2][1] - quad[1][1])) / 2.0
    aspect = w / h

    canvas_h = logo.height / FILL
    canvas_w = canvas_h * aspect
    if canvas_w < logo.width * 1.05:      # artwork is the wider constraint
        canvas_w = logo.width * 1.05
        canvas_h = canvas_w / aspect

    canvas = Image.new("RGBA", (int(round(canvas_w)), int(round(canvas_h))),
                       (0, 0, 0, 0))
    canvas.alpha_composite(logo, ((canvas.width - logo.width) // 2,
                                  (canvas.height - logo.height) // 2))
    return canvas


def main():
    if not os.path.exists(SRC):
        sys.exit("missing " + SRC)

    # Always brand the pristine photo, so re-running never stacks logos.
    if os.path.exists(BACKUP):
        photo = Image.open(BACKUP).convert("RGB")
    else:
        photo = Image.open(SRC).convert("RGB")
        photo.save(BACKUP, "WEBP", quality=95)
        print("kept original at", os.path.basename(BACKUP))

    W, H = photo.size
    dst = [(x * SS, y * SS) for x, y in QUAD]

    # Render supersampled, then shape the canvas to the quad so nothing skews.
    quad_h = max(abs(QUAD[3][1] - QUAD[0][1]), abs(QUAD[2][1] - QUAD[1][1])) * SS
    logo = fit_to_quad(build_logo(int(quad_h)), QUAD)

    src = [(0, 0), (logo.width, 0), (logo.width, logo.height), (0, logo.height)]
    coeffs = perspective_coeffs(dst, src)

    layer_ss = logo.transform((W * SS, H * SS), Image.PERSPECTIVE, coeffs,
                              resample=Image.BICUBIC)
    layer = layer_ss.resize((W, H), Image.LANCZOS)

    # Multiply the ink into the photo so ribs and shading survive.
    ink_on_white = Image.new("RGB", (W, H), (255, 255, 255))
    ink_on_white.paste(layer, (0, 0), layer)
    multiplied = ImageChops.multiply(photo, ink_on_white)
    mask = layer.getchannel("A").point(lambda v: int(v * INK_ALPHA))

    out = Image.composite(multiplied, photo, mask)
    out.save(SRC, "WEBP", quality=90, method=6)
    print("branded ->", os.path.basename(SRC),
          "(%d x %d, %.0f KB)" % (W, H, os.path.getsize(SRC) / 1024))


if __name__ == "__main__":
    main()
