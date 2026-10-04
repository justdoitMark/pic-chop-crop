"""Compare Rust masks with Python masks of the same photos.

    python compare.py out/rs birefnet_lite-fp16-dml     # exits 1 if any photo fails

Pass: at most 1 % of pixels differ by more than 8/255 (plan, stage D).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
TOLERANCE = 8          # out of 255
MAX_SHARE = 0.01       # 1 % of pixels


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    rs_dir, py_dir = Path(sys.argv[1]), ROOT / "out" / sys.argv[2]
    failed, seen = False, 0
    for rs_mask in sorted(rs_dir.glob("*.mask.png")):
        py_mask = py_dir / rs_mask.name
        if not py_mask.exists():
            print(f"skip {rs_mask.name}: no Python mask in {py_dir}")
            continue
        seen += 1
        a = np.asarray(Image.open(rs_mask), np.int16)
        b = np.asarray(Image.open(py_mask), np.int16)
        if a.shape != b.shape:
            print(f"FAIL {rs_mask.name}: shape {a.shape} != {b.shape}")
            failed = True
            continue
        diff = np.abs(a - b)
        share = float((diff > TOLERANCE).mean())
        bad = share > MAX_SHARE
        failed |= bad
        print(f"{'FAIL' if bad else 'ok  '} {rs_mask.name}: {share * 100:.3f} % pixels off by > {TOLERANCE}/255, "
              f"max diff {int(diff.max())}")
    if seen == 0:
        print("no masks compared")
        failed = True
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
