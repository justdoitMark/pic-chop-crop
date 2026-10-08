"""Before/after sheet + numbers for one IC-Light run (inside the subject only).

    python stage_e/iclight_sheet.py <fg.png> <raw.png> <detail.png> <out_sheet.png>

Numbers inside the subject mask: median dE (CIE76, Lab; light and colour together),
median hue shift and chroma ratio where the input is colourful (colour of the object,
not its brightness), and detail kept (correlation of the input and output high-pass).
"""
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def lab(img):
    a = np.asarray(img.convert("RGB"), np.float32) / 255
    a = np.where(a > 0.04045, ((a + 0.055) / 1.055) ** 2.4, a / 12.92)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], np.float32)
    xyz = a @ m.T / np.array([0.9505, 1.0, 1.089], np.float32)
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def highpass(img):
    g = img.convert("L")
    return np.asarray(g, np.float32) - np.asarray(g.filter(ImageFilter.GaussianBlur(2)), np.float32)


def numbers(fg, out, mask):
    la, lb = lab(fg), lab(out)
    de = np.linalg.norm(la - lb, axis=-1)[mask]
    # colour of the object, not its lighting: hue angle and chroma where the input is colourful
    ca, cb = np.hypot(la[..., 1], la[..., 2]), np.hypot(lb[..., 1], lb[..., 2])
    colourful = mask & (ca > 10)
    dh = np.degrees(np.angle(np.exp(1j * (np.arctan2(lb[..., 2], lb[..., 1]) - np.arctan2(la[..., 2], la[..., 1])))))
    hue = float(np.median(np.abs(dh[colourful]))) if colourful.any() else float("nan")
    chroma = float(np.median(cb[colourful] / ca[colourful])) if colourful.any() else float("nan")
    hp_a, hp_b = highpass(fg)[mask], highpass(out)[mask]
    corr = float(np.corrcoef(hp_a, hp_b)[0, 1])
    return float(np.median(de)), hue, chroma, corr


def main():
    fg, raw, det = (Image.open(p).convert("RGB") for p in sys.argv[1:4])
    # subject = pixels that are not the flat 127-gray backdrop in the input
    arr = np.asarray(fg, np.int16)
    mask = np.abs(arr - 127).max(axis=-1) > 6
    mask = np.asarray(Image.fromarray(mask.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(5))) > 0
    rows = []
    for name, img in (("IC-Light", raw), ("IC-Light + DetailTransfer", det)):
        de, hue, chroma, corr = numbers(fg, img, mask)
        rows.append(f"{name}: dE {de:.1f}, hue shift {hue:.0f} deg, chroma x{chroma:.2f}, detail r={corr:.2f}")
        print(f"{sys.argv[1]} -> {rows[-1]}")
    w, h = fg.size
    sheet = Image.new("RGB", (w * 3 + 20, h + 40), "white")
    for i, (img, label) in enumerate(((fg, "before (BiRefNet cut on gray)"), (raw, "IC-Light"), (det, "IC-Light + DetailTransfer"))):
        sheet.paste(img, (i * (w + 10), 40))
        ImageDraw.Draw(sheet).text((i * (w + 10) + 4, 4), label, fill="black")
    ImageDraw.Draw(sheet).text((4, 22), " | ".join(rows), fill="black")
    sheet.save(sys.argv[4])


if __name__ == "__main__":
    main()
