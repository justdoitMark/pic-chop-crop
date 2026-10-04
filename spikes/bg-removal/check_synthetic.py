"""Compare bench masks of the synthetic photos with their true masks (IoU).

    python check_synthetic.py      # exits 1 if any mask is below MIN_IOU

A low IoU on exif6.jpg alone means EXIF orientation is mishandled; low on
all photos means preprocessing or the output transform is wrong.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
SYNTH = ROOT / "out" / "synthetic"
RUN = ROOT / "out" / "synthetic-run"  # bench.py --photos out/synthetic --out out/synthetic-run
MIN_IOU = 0.9


def iou(a, b):
    return (a & b).sum() / max((a | b).sum(), 1)


def main():
    failed = False
    for truth_path in sorted((SYNTH / "truth").glob("*.png")):
        stem = truth_path.stem
        truth = np.asarray(Image.open(truth_path)) > 127
        for mask_path in sorted(RUN.glob(f"*/{stem}.mask.png")):
            mask = np.asarray(Image.open(mask_path))
            if mask.shape != truth.shape:
                score, note = 0.0, f"shape {mask.shape} != {truth.shape}"
            else:
                score, note = iou(mask > 127, truth), ""
            bad = score < MIN_IOU
            failed |= bad
            print(f"{'FAIL' if bad else 'ok  '} {mask_path.parent.name:28} {stem:6} IoU={score:.3f} {note}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
