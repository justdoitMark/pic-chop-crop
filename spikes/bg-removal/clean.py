"""Edge clean-up: re-estimate foreground colors so the old background does not
show through soft edges (the sofa "glowing" through hair and fringes).

    python clean.py birefnet_lite-fp16-dml ben2-fp16-dml   # -> out/<run>-clean/
    python clean.py --time                                  # time 12 MP and 24 MP only

Uses pymatting.estimate_foreground_ml (MIT). Reads each photo and the run's
mask, writes <stem>.white.jpg, <stem>.black.jpg, <stem>.cut.png and a copy of
the mask, and appends timings to out/clean_times.csv.
"""
import argparse
import csv
import shutil
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from pymatting import estimate_foreground_ml

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "out"
PHOTOS = ROOT / "photos"
TIMES_CSV = OUT / "clean_times.csv"
SIZES_MP = {"12mp": (4032, 3024), "24mp": (6000, 4000)}


def load_rgb(path):
    with Image.open(path) as img:
        return np.asarray(ImageOps.exif_transpose(img).convert("RGB"), np.float64) / 255.0


def clean(image, alpha):
    """Returns the foreground colors (h, w, 3 in [0, 1]) and seconds taken."""
    t = time.perf_counter()
    fg = estimate_foreground_ml(image, alpha)
    return np.clip(fg, 0.0, 1.0), time.perf_counter() - t


def compose(fg, alpha, ground):
    a = alpha[..., None]
    return fg * a + np.asarray(ground, np.float64) * (1.0 - a)


def to_img(arr):
    return Image.fromarray((arr * 255 + 0.5).astype(np.uint8))


def warm_up():
    """First call JIT-compiles numba code; keep that out of the timings."""
    clean(np.random.rand(64, 64, 3), np.random.rand(64, 64))


def append_times(rows):
    new = not TIMES_CSV.exists()
    with TIMES_CSV.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, ["run", "photo", "width", "height", "seconds"])
        if new:
            w.writeheader()
        w.writerows(rows)


def clean_run(run):
    src, dst = OUT / run, OUT / f"{run}-clean"
    dst.mkdir(parents=True, exist_ok=True)
    rows = []
    for mask_path in sorted(src.glob("*.mask.png")):
        stem = mask_path.name.removesuffix(".mask.png")
        photo = next((p for p in PHOTOS.glob(f"{stem}.*") if p.suffix.lower() in {".jpg", ".jpeg", ".png"}), None)
        if photo is None:
            continue
        image = load_rgb(photo)
        alpha = np.asarray(Image.open(mask_path), np.float64) / 255.0
        fg, seconds = clean(image, alpha)
        to_img(compose(fg, alpha, (1, 1, 1))).save(dst / f"{stem}.white.jpg", quality=92)
        to_img(compose(fg, alpha, (0, 0, 0))).save(dst / f"{stem}.black.jpg", quality=92)
        cut = to_img(fg)
        cut.putalpha(Image.open(mask_path))
        cut.save(dst / f"{stem}.cut.png", compress_level=1)
        shutil.copyfile(mask_path, dst / mask_path.name)
        rows.append({"run": run, "photo": photo.name, "width": image.shape[1],
                     "height": image.shape[0], "seconds": round(seconds, 2)})
        print(f"  {run} {photo.name}: {seconds:.1f} s", flush=True)
    append_times(rows)


def time_sizes():
    """Time the clean-up on 12 and 24 MP with a soft blob mask (content barely matters)."""
    rows = []
    for label, (w, h) in SIZES_MP.items():
        rng = np.random.default_rng(0)
        image = rng.random((h, w, 3))
        blob = Image.new("L", (w, h), 0)
        ImageDraw.Draw(blob).ellipse((w * 0.25, h * 0.2, w * 0.75, h * 0.8), fill=255)
        alpha = np.asarray(blob.filter(ImageFilter.GaussianBlur(12)), np.float64) / 255.0
        _, seconds = clean(image, alpha)
        rows.append({"run": "timing", "photo": label, "width": w, "height": h, "seconds": round(seconds, 2)})
        print(f"  {label} ({w}x{h}): {seconds:.1f} s", flush=True)
    append_times(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("runs", nargs="*", help="run folders under out/, e.g. birefnet_lite-fp16-dml")
    ap.add_argument("--time", action="store_true", help="only time 12 MP and 24 MP")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)
    warm_up()
    if args.time:
        time_sizes()
    for run in args.runs:
        clean_run(run)


if __name__ == "__main__":
    main()
