"""Can IC-Light keep product text? One input, one prompt -> variants, OCR scores, a sheet.

    python stage_e/relight_exp.py <cut.png> <tag> --prompt "..." [--comfy C:/AI-Workspace/sandbox/iclight/ComfyUI_windows_portable/ComfyUI]

Needs the local ComfyUI server (see iclight_run.py). Variants:
  V0 raw IC-Light at 768 (the look the user liked)       V1 raw at 1024      V2 raw at 1536
  V3 V0 + the IC-Light demo's highres pass (x2, denoise 0.5)
  V4 V0, but inside the text mask (PP-OCR detection, textdet.py) the original letter shapes
     as luminance detail (colour stays V0's)
  V5 the original everywhere under V0's light (light ratio over the whole object: keeps the colours)
  V6 V2 + the same text detail as V4
OCR = similarity of the OCR text of a variant to the OCR text of the input
(Windows.Media.Ocr, offline); text r = correlation of the input/output fine detail inside
the text mask (works where OCR reads nothing). Only scores are printed; recognised text stays in
out/relight/<tag>/ocr/*.json (photos may contain plates and names).
"""
import argparse
import difflib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import iclight_sheet  # noqa: E402
import textdet  # noqa: E402

SIZES = (768, 1024, 1536)
PY = sys.executable


def sh(*args, check=True):
    r = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if r.returncode and check:
        cmd = " ".join(str(a) for a in args)[:200]
        sys.exit(f"failed: {cmd}\n{r.stderr[-800:]}")
    return r


def queue(*args):
    """Queue an IC-Light run; the output files are awaited separately (newest())."""
    r = sh(*args, check=False)
    if r.returncode:
        print(f"  client error (waiting for the files anyway): {r.stderr.strip().splitlines()[-1][:120]}")


def ocr(image, out_json):
    sh("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", HERE / "ocr.ps1",
       "-Image", image, "-Out", out_json)
    data = json.loads(Path(out_json).read_text(encoding="utf-8-sig"))
    lines = data.get("lines") or []
    return lines if isinstance(lines, list) else [lines]


def text_of(lines):
    return " ".join(line["text"] for line in lines)


def similarity(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio() if a or b else 1.0


def word_boxes(lines):
    for line in lines:
        words = line["words"] if isinstance(line["words"], list) else [line["words"]]
        for w in words:
            yield w["x"], w["y"], w["w"], w["h"]


def blur(a, sigma):
    """Separable Gaussian on a float (h, w, c) array (PIL cannot blur float images)."""
    r = int(3 * sigma + 0.5)
    k = np.exp(-np.arange(-r, r + 1) ** 2 / (2 * sigma ** 2))
    k /= k.sum()
    p = np.pad(a, ((r, r), (0, 0), (0, 0)), mode="reflect")
    a = sum(k[i] * p[i:i + a.shape[0]] for i in range(2 * r + 1))
    p = np.pad(a, ((0, 0), (r, r), (0, 0)), mode="reflect")
    return sum(k[i] * p[:, i:i + a.shape[1]] for i in range(2 * r + 1))


def light_transfer(src, relit, sigma, obj):
    """Original pixels under the new light: src * blur(relit) / blur(src), per channel.
    The blur is normalised inside the object (obj mask), so the gray backdrop does not
    leak into the ratio as a glow along the outline."""
    s = np.asarray(src, np.float32) / 255
    r = np.asarray(relit, np.float32) / 255
    m = obj.astype(np.float32)[..., None]
    w = blur(np.repeat(m, 3, -1), sigma) + 1e-4
    ratio = (blur(r * m, sigma) / w + 0.02) / (blur(s * m, sigma) / w + 0.02)
    out = np.clip(s * np.clip(ratio, 0, 4), 0, 1)
    return out * m + r * (1 - m)


def luma(a):
    return a @ np.array([0.299, 0.587, 0.114], np.float32)


def text_detail(src, relit, text, sigma):
    """Inside the text mask, put the original's letter shapes into the relit image as
    luminance only: relit low-pass + original high-pass (contrast-matched); the colour
    stays the relit one, so the label keeps the IC-Light look."""
    s = np.asarray(src, np.float32) / 255
    r = np.asarray(relit, np.float32) / 255
    ys, yr = luma(s)[..., None], luma(r)[..., None]
    bs, br = blur(ys, sigma), blur(yr, sigma)
    gain = np.clip((br + 0.02) / (bs + 0.02), 0, 4)
    y_new = br + (ys - bs) * gain
    out = r + (y_new - yr)
    t = text[..., None]
    return np.clip(r * (1 - t) + out * t, 0, 1)


def to_img(a):
    return Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))


def sheet(items, out, height=768):
    cells = []
    for label, img in items:
        im = img.resize((round(img.width * height / img.height), height), Image.Resampling.LANCZOS)
        cells.append((label, im))
    w = sum(im.width for _, im in cells) + 10 * (len(cells) - 1)
    canvas = Image.new("RGB", (w, height + 44), "white")
    x = 0
    for label, im in cells:
        canvas.paste(im, (x, 44))
        for i, part in enumerate(label.split("\n")):
            ImageDraw.Draw(canvas).text((x + 4, 4 + 14 * i), part, fill="black")
        x += im.width + 10
    canvas.save(out)


def crop_strip(items, box_norm, out, cell=384):
    """The same text region from every variant, each at its own resolution, side by side."""
    x0, y0, x1, y1 = box_norm
    cells = []
    for label, img in items:
        c = img.crop((round(x0 * img.width), round(y0 * img.height), round(x1 * img.width), round(y1 * img.height)))
        k = cell / max(c.size)
        cells.append((label, c.resize((max(1, round(c.width * k)), max(1, round(c.height * k))), Image.Resampling.LANCZOS)))
    h = max(c.height for _, c in cells)
    canvas = Image.new("RGB", (sum(c.width for _, c in cells) + 10 * len(cells), h + 30), "white")
    x = 0
    for label, c in cells:
        canvas.paste(c, (x, 30))
        ImageDraw.Draw(canvas).text((x + 2, 4), label.split("\n")[0], fill="black")
        x += c.width + 10
    canvas.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cut")
    ap.add_argument("tag")
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--comfy", default="C:/AI-Workspace/sandbox/iclight/ComfyUI_windows_portable/ComfyUI")
    ap.add_argument("--show-text", action="store_true", help="print recognised text (synthetic inputs only)")
    args = ap.parse_args()

    comfy_in, comfy_out = Path(args.comfy) / "input", Path(args.comfy) / "output"
    work = ROOT / "out" / "relight" / args.tag
    (work / "ocr").mkdir(parents=True, exist_ok=True)
    stem = Path(args.cut).name.split(".")[0]

    fg = {}
    for n in SIZES:
        sh(PY, HERE / "iclight_run.py", "prep", args.cut, work / f"fg{n}", "--long", n)
        src = work / f"fg{n}" / f"{stem}_fg.png"
        shutil.copy(src, comfy_in / f"{args.tag}_fg{n}.png")
        fg[n] = Image.open(src).convert("RGB")

    run = [PY, HERE / "iclight_run.py", "run"]
    common = ["--prompt", args.prompt, "--seed", args.seed, "--input-dir", comfy_in]
    for old in comfy_out.glob(f"{args.tag}_*.png"):
        old.unlink()
    queue(*run, f"{args.tag}_fg768.png", f"{args.tag}_768", *common, "--hires-fg", f"{args.tag}_fg1536.png")
    for n in SIZES[1:]:
        queue(*run, f"{args.tag}_fg{n}.png", f"{args.tag}_{n}", *common)

    def newest(prefix, timeout=300):
        # the client can lose the server's reply (local connection resets), so wait for the file itself
        deadline = time.time() + timeout
        while time.time() < deadline:
            found = sorted(comfy_out.glob(f"{prefix}_*.png"))
            if found and time.time() - found[-1].stat().st_mtime > 0.5:
                return Image.open(found[-1]).convert("RGB")
            time.sleep(0.5)
        sys.exit(f"no output {prefix} after {timeout} s")

    v = {
        "V0 raw 768": newest(f"{args.tag}_768_raw"),
        "V1 raw 1024": newest(f"{args.tag}_1024_raw"),
        "V2 raw 1536": newest(f"{args.tag}_1536_raw"),
        "V3 768 + highres x2": newest(f"{args.tag}_768_hires"),
    }
    obj = iclight_sheet_mask(fg[768])
    ref_lines = ocr(work / "fg768" / f"{stem}_fg.png", work / "ocr" / "input768.json")
    mask, line_h, cover = textdet.text_mask(fg[768])
    sigma = max(3.0, 1.5 * line_h)
    v["V4 V0 + text detail"] = to_img(text_detail(fg[768], v["V0 raw 768"], mask, sigma))
    v["V5 original under V0 light"] = to_img(light_transfer(fg[768], v["V0 raw 768"], max(8.0, sigma), obj))
    mask_big, line_h_big, _ = textdet.text_mask(fg[1536])
    v2 = v["V2 raw 1536"].resize(fg[1536].size, Image.Resampling.LANCZOS)
    v["V6 V2 + text detail"] = to_img(text_detail(fg[1536], v2, mask_big, max(3.0, 1.5 * line_h_big)))
    in_text = mask > 0.5
    hp = lambda img: luma(np.asarray(img.resize(fg[768].size, Image.Resampling.LANCZOS), np.float32) / 255)

    def r_text(img):
        """Letter detail kept: correlation of input/output high-pass inside the text mask (768)."""
        if not in_text.any():
            return float("nan")
        a, b = hp(fg[768]), hp(img)
        a, b = a - blur(a[..., None], 2.0)[..., 0], b - blur(b[..., None], 2.0)[..., 0]
        return float(np.corrcoef(a[in_text], b[in_text])[0, 1])

    ref = {n: text_of(ocr(work / f"fg{n}" / f"{stem}_fg.png", work / "ocr" / f"input{n}.json")) for n in SIZES}
    if args.show_text:
        print(f"  input OCR @768: {ref[768]!r}")
    rows, labels = [], {}
    for name, img in v.items():
        path = work / f"{name.split()[0]}.png"
        img.save(path)
        got = text_of(ocr(path, work / "ocr" / f"{name.split()[0]}.json"))
        score = similarity(got, ref[768])
        _, hue, chroma, r = iclight_numbers(fg[768], img)
        rt = r_text(img)
        rows.append(f"{name:28} OCR {score:.2f}  text r {rt:.2f}  hue {hue:5.0f} deg  chroma x{chroma:.2f}  detail r {r:.2f}")
        labels[name] = f"{name}\nOCR {score:.2f}  text r {rt:.2f}"
        if args.show_text:
            rows[-1] += f"  ocr {got!r}"
    print(f"{args.tag}: text mask {cover * 100:.2f} % of the image, line {line_h:.0f} px at 768; "
          f"{len(list(word_boxes(ref_lines)))} OCR words in the input")
    for row in rows:
        print("  " + row)

    items = [("input 768", fg[768])] + [(labels[k], img) for k, img in v.items()]
    sheet(items, work / "sheet.png")
    if in_text.any():
        ys, xs = np.nonzero(in_text)
        W, H = fg[768].size
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max(), ys.max()
        pad = 0.15 * max(x1 - x0, y1 - y0)
        box = (max(0, x0 - pad) / W, max(0, y0 - pad) / H, min(W, x1 + pad) / W, min(H, y1 + pad) / H)
        crop_strip([("input 1536", fg[1536])] + list(v.items()), box, work / "text_crops.png")


def iclight_sheet_mask(fg):
    arr = np.asarray(fg, np.int16)
    m = np.abs(arr - 127).max(axis=-1) > 6
    return np.asarray(Image.fromarray(m.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(5))) > 0


def iclight_numbers(fg, img):
    """Colour/detail numbers vs the 768 input, on the object only (any variant size)."""
    img = img.resize(fg.size, Image.Resampling.LANCZOS)
    _, hue, chroma, r = iclight_sheet.numbers(fg, img, iclight_sheet_mask(fg))
    return None, hue, chroma, r


if __name__ == "__main__":
    main()
