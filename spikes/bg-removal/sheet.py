"""Build out/sheet.html: a blind viewer for rating cut-outs 1-5, one photo at a time.

    python sheet.py --columns isnet-fp32-dml ben2-fp16-dml ...        # -> out/sheet.html
    python sheet.py --name clean --columns ben2-fp16-dml-clean ...     # -> out/sheet-clean.html

Columns are shown as letters (A, B, ...) in a fixed shuffled order, so the
model name does not sway the rating; the key is in out/sheet_key[-name].json
and in the exported ratings. Keep the same --columns order to keep the same
letters: ratings live in the browser's localStorage under those letters.

The page (sheet_template.html) shows all columns of one photo side by side
with zoom and pan shared between them. It loads 1600 px previews from
out/previews/ and swaps in the full image when zoomed past them.
"""
import argparse
import csv
import json
import os
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
TEMPLATE = ROOT / "sheet_template.html"
PREVIEW_SIZE = 1600
MODEL_ORDER = ["isnet", "birefnet_lite", "birefnet", "ben2"]
SHUFFLE_SEED = 7
STORE_KEY = "pcc-bg-ratings"


def default_columns(out):
    """One DML run per model: fp16 unless results.csv marks it suspect or failed."""
    with (out / "results.csv").open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    columns = []
    for model in MODEL_ORDER:
        for precision in ("fp16", "fp32"):
            mine = [r for r in rows if r["model"] == model and r["precision"] == precision
                    and r["provider"] == "dml"]
            if mine and not any(r["suspect"] == "True" or r["error"] for r in mine):
                columns.append(f"{model}-{precision}-dml")
                break
    return columns


def preview(src, dest):
    """A downsized copy in display orientation; returns the source's display size."""
    with Image.open(src) as img:
        img = ImageOps.exif_transpose(img)
        size = img.size
        if not dest.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            img.thumbnail((PREVIEW_SIZE, PREVIEW_SIZE), Image.Resampling.LANCZOS)
            if dest.suffix == ".png":
                img.save(dest, compress_level=6)
            else:
                img.convert("RGB").save(dest, quality=90)
    return size


def edge_point(mask_path):
    """A point on the object's outline (top of the mask), as fractions of w/h."""
    m = np.asarray(Image.open(mask_path)) > 127
    rows = np.flatnonzero(m.any(axis=1))
    if rows.size == 0:
        return 0.5, 0.5
    top = rows[0]
    cols = np.flatnonzero(m[top])
    return float(cols[cols.size // 2] / m.shape[1]), float(top / m.shape[0])


def build(columns, out, photos_dir, name):
    """Write the sheet, its key file and previews in <out>/previews/."""
    def rel(path):  # URL of a file relative to the sheet
        return Path(os.path.relpath(path, out)).as_posix()

    suffix = f"-{name}" if name else ""
    previews = out / "previews"
    photos = sorted(p for p in photos_dir.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png"})
    order = columns[:]
    random.Random(SHUFFLE_SEED).shuffle(order)
    letters = {col: chr(ord("A") + i) for i, col in enumerate(order)}
    key = {letters[c]: c for c in order}
    (out / f"sheet_key{suffix}.json").write_text(json.dumps(key, indent=2))

    data = {"store": STORE_KEY + suffix, "columns": [letters[c] for c in order],
            "key": key, "photos": []}
    for photo in photos:
        orig_prev = previews / "orig" / f"{photo.stem}.jpg"
        w, h = preview(photo, orig_prev)
        entry = {"name": photo.name, "w": w, "h": h,
                 "orig": {"p": rel(orig_prev), "full": rel(photo)}, "cells": {}}
        for col in order:
            full = out / col / f"{photo.stem}.cut.png"
            if full.exists():
                p = previews / col / f"{photo.stem}.png"
                preview(full, p)
                entry["cells"][letters[col]] = {"p": rel(p), "full": rel(full)}
        masks = [out / c / f"{photo.stem}.mask.png" for c in order]
        mask = next((m for m in masks if m.exists()), None)
        entry["edge"] = edge_point(mask) if mask else (0.5, 0.5)
        data["photos"].append(entry)

    # Inside <script> entities are not decoded; only "</" can end the block early.
    page = TEMPLATE.read_text(encoding="utf-8").replace(
        "__DATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
    target = out / f"sheet{suffix}.html"
    target.write_text(page, encoding="utf-8")
    print(f"wrote {target}: {len(photos)} photos x {len(order)} columns")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--columns", nargs="+", help="run folders under <out> to show")
    ap.add_argument("--name", default="", help="sheet-<name>.html with its own ratings store")
    ap.add_argument("--out", default=str(ROOT / "out"))
    ap.add_argument("--photos", default=str(ROOT / "photos"))
    args = ap.parse_args()
    out = Path(args.out).resolve()
    build(args.columns or default_columns(out), out, Path(args.photos).resolve(), args.name)


if __name__ == "__main__":
    main()
