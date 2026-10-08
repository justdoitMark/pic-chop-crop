"""Checks for the Real-ESRGAN ncnn-vulkan run. Photos are measured, not looked at.

    python stage_e/sr_tools.py crop <photo> <mask.png> <out.png>
        1024x1024 window inside the subject's bbox with the most edge detail
    python stage_e/sr_tools.py check <in.png> <out_x4.png>
        size, PSNR of the x4 result scaled back down vs the input, share of black pixels
    python stage_e/sr_tools.py seams <tiled.png> <reference.png> <tile size in output px>
        mean |tiled - reference| on the tile grid vs elsewhere (ratio >> 1: seams);
        the reference is a run with a larger tile (fewer seams)
"""
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageOps

SIZE = 1024


def crop(photo, mask_path, out):
    img = ImageOps.exif_transpose(Image.open(photo)).convert("RGB")
    ys, xs = np.nonzero(np.asarray(Image.open(mask_path)) > 127)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    # edge density per window position, at 1/8 scale
    k = 8
    small = img.convert("L").resize((img.width // k, img.height // k), Image.Resampling.BOX)
    edges = np.asarray(small.filter(ImageFilter.FIND_EDGES), np.float32)
    win = SIZE // k
    integral = np.pad(edges.cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    best, pos = -1.0, (0, 0)
    for y in range(y0 // k, max(min(y1 // k - win, edges.shape[0] - win), y0 // k) + 1, 4):
        for x in range(x0 // k, max(min(x1 // k - win, edges.shape[1] - win), x0 // k) + 1, 4):
            s = integral[y + win, x + win] - integral[y, x + win] - integral[y + win, x] + integral[y, x]
            if s > best:
                best, pos = s, (x * k, y * k)
    x, y = min(pos[0], img.width - SIZE), min(pos[1], img.height - SIZE)
    img.crop((x, y, x + SIZE, y + SIZE)).save(out)
    print(f"{out}: crop at ({x}, {y}) of {img.width}x{img.height}")


def psnr(a, b):
    mse = np.mean((a.astype(np.float64) - b.astype(np.float64)) ** 2)
    return 99.0 if mse == 0 else 10 * np.log10(255 ** 2 / mse)


def check(inp, out):
    a = Image.open(inp).convert("RGB")
    b = Image.open(out).convert("RGB")
    down = b.resize(a.size, Image.Resampling.BICUBIC)
    black = float((np.asarray(b).max(axis=2) < 3).mean())
    black_in = float((np.asarray(a).max(axis=2) < 3).mean())
    print(f"{out}: {b.width}x{b.height} (in {a.width}x{a.height}), "
          f"PSNR back-down {psnr(np.asarray(a), np.asarray(down)):.1f} dB, "
          f"black share {black * 100:.2f} % (input {black_in * 100:.2f} %)")


def seams(tiled, ref, tile_out):
    a = np.asarray(Image.open(tiled).convert("RGB"), np.float32)
    b = np.asarray(Image.open(ref).convert("RGB"), np.float32)
    d = np.abs(a - b).mean(axis=2)

    def grid(n):
        idx = np.arange(n)
        near = np.minimum(idx % tile_out, tile_out - idx % tile_out) <= 8
        near[:9] = near[-9:] = False  # image borders are not seams
        return near

    band = grid(d.shape[0])[:, None] | grid(d.shape[1])[None, :]
    print(f"{tiled}: mean diff vs reference {d.mean():.2f}, on tile grid {d[band].mean():.2f}, "
          f"elsewhere {d[~band].mean():.2f}, ratio {d[band].mean() / max(d[~band].mean(), 1e-6):.2f}, "
          f"max {d.max():.0f}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "crop":
        crop(*sys.argv[2:5])
    elif cmd == "check":
        check(*sys.argv[2:4])
    elif cmd == "seams":
        seams(sys.argv[2], sys.argv[3], int(sys.argv[4]))
    else:
        sys.exit(__doc__)
