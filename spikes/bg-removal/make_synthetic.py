"""Make synthetic test photos with a known true mask, to check the pipeline.

Not a quality test: it only proves that preprocessing, the output transform
and EXIF handling are right. A broken step shows up as a low IoU in
check_synthetic.py.

Writes:
  out/synthetic/plain.jpg     4032x3024 (12 MP), no EXIF
  out/synthetic/exif6.jpg     stored as 3024x4032 with EXIF Orientation=6, displays as 4032x3024
  out/synthetic/truth/*.png   true masks in display orientation
  out/synthetic-24mp/big24.jpg  6000x4000 (24 MP), only for timing the edge clean-up step
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out" / "synthetic"
ORIENTATION_TAG = 0x0112


def scene(width, height, seed):
    """A blue 'bag' with a strap on a noisy beige 'sofa'. Returns (rgb, truth)."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:height, 0:width]
    base = np.stack([200 - 40 * yy / height, 180 - 30 * yy / height, 150 + 0 * xx], -1)
    noise = rng.normal(0, 12, (height, width, 1))
    background = Image.fromarray(np.clip(base + noise, 0, 255).astype(np.uint8))

    truth = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(truth)
    w, h = width, height
    body = (int(w * 0.32), int(h * 0.30), int(w * 0.68), int(h * 0.85))
    draw.rounded_rectangle(body, radius=int(w * 0.04), fill=255)
    strap = (int(w * 0.38), int(h * 0.12), int(w * 0.62), int(h * 0.48))
    draw.arc(strap, 180, 360, fill=255, width=max(8, int(w * 0.012)))

    obj = np.zeros((height, width, 3), np.float32)
    obj[:] = (40, 70, 140)
    shade = 0.75 + 0.25 * (1 - yy / height)
    obj = obj * shade[..., None] + rng.normal(0, 6, (height, width, 1))
    pocket = (int(w * 0.40), int(h * 0.55), int(w * 0.60), int(h * 0.78))
    obj_img = Image.fromarray(np.clip(obj, 0, 255).astype(np.uint8))
    ImageDraw.Draw(obj_img).rectangle(pocket, fill=(60, 95, 170))

    soft = truth.filter(ImageFilter.GaussianBlur(1.5))
    rgb = Image.composite(obj_img, background, soft)
    return rgb, truth


def main():
    truth_dir = OUT / "truth"
    big_dir = OUT.parent / "synthetic-24mp"
    for d in (truth_dir, big_dir):
        d.mkdir(parents=True, exist_ok=True)

    rgb, truth = scene(4032, 3024, seed=1)
    rgb.save(OUT / "plain.jpg", quality=92)
    truth.save(truth_dir / "plain.png")

    # Stored rotated 90 deg counter-clockwise; Orientation=6 tells viewers to
    # turn it 90 deg clockwise, which gives back the 4032x3024 scene.
    rgb, truth = scene(4032, 3024, seed=2)
    stored = rgb.transpose(Image.Transpose.ROTATE_90)
    exif = Image.Exif()
    exif[ORIENTATION_TAG] = 6
    stored.save(OUT / "exif6.jpg", quality=92, exif=exif.tobytes())
    truth.save(truth_dir / "exif6.png")

    rgb, _ = scene(6000, 4000, seed=3)
    rgb.save(big_dir / "big24.jpg", quality=92)
    print(f"wrote {OUT} and {big_dir}")


if __name__ == "__main__":
    main()
