"""Where is text? PP-OCRv4 detection (DBNet, Apache-2.0, 4.7 MB ONNX) -> soft text mask.

    python stage_e/textdet.py <image> [out_mask.png]     # prints coverage and line height only

Model: models/ppocr/ch_PP-OCRv4_det_infer.onnx from SWHL/RapidOCR on Hugging Face.
Preprocessing as PaddleOCR's det config: long side 960 (multiple of 32), BGR, /255,
ImageNet mean/std. Output is a text probability map; threshold 0.3 as DB does.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "models" / "ppocr" / "ch_PP-OCRv4_det_infer.onnx"
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
_session = None


def prob_map(img):
    global _session
    import onnxruntime as ort
    if _session is None:
        _session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    k = 960 / max(img.size)
    w, h = (max(32, round(v * k / 32) * 32) for v in img.size)
    x = np.asarray(img.convert("RGB").resize((w, h), Image.Resampling.BILINEAR), np.float32)[..., ::-1] / 255
    x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    p = _session.run(None, {"x": x})[0][0, 0]
    return Image.fromarray(p.astype(np.float32), "F").resize(img.size, Image.Resampling.BILINEAR)


def line_height(binary):
    """Median height of vertical runs of the text mask = typical text line height (px)."""
    runs = []
    for col in binary.T[::4]:
        d = np.diff(np.concatenate(([0], col.astype(np.int8), [0])))
        starts, ends = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
        runs.extend(ends - starts)
    return float(np.median(runs)) if runs else 0.0


def text_mask(img):
    """(soft mask in [0, 1] at img size, line height px, coverage share)."""
    binary = np.asarray(prob_map(img)) > 0.3
    h = line_height(binary)
    if h == 0:
        return np.zeros(binary.shape, np.float32), 0.0, 0.0
    # DB maps hug the letters (shrunk kernels): grow by a line height, then feather
    grow = max(3, int(h) | 1)
    m = Image.fromarray(binary.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(grow))
    m = m.filter(ImageFilter.GaussianBlur(max(1.5, h / 6)))
    soft = np.asarray(m, np.float32) / 255
    return soft, h, float(binary.mean())


if __name__ == "__main__":
    image = Image.open(sys.argv[1])
    soft, h, cover = text_mask(image)
    print(f"{sys.argv[1]}: text pixels {cover * 100:.2f} %, line height {h:.0f} px")
    if len(sys.argv) > 2:
        Image.fromarray((soft * 255).astype(np.uint8)).save(sys.argv[2])
