"""Run background-removal models over local photos and time them.

    python bench.py                       # all models x precisions x providers over photos/
    python bench.py --photos out/synthetic --models isnet --providers dml
    python bench.py --inspect             # print inputs/outputs + preprocessing per model

Each (model, precision, provider) runs in its own child process, so the peak
memory and the session/first-run times are not skewed by earlier runs.
Preprocessing comes from each model's preprocessor_config.json, input names,
shapes and dtypes from session.get_inputs(). Nothing is guessed.

Writes <out>/<model>-<precision>-<provider>/<photo>.{mask.png,cut.png,white.jpg,black.jpg}
and appends one row per photo to <out>/results.csv (<out> defaults to out/).
Photos never leave the machine.
"""
import argparse
import csv
import json
import platform
import statistics
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import psutil
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent
MODELS_DIR = ROOT / "models"
OUT_DIR = ROOT / "out"
PHOTO_EXTS = {".jpg", ".jpeg", ".png"}

PROVIDERS = {"dml": "DmlExecutionProvider", "cpu": "CPUExecutionProvider"}
PRECISION_FILES = {"fp32": "model.onnx", "fp16": "model_fp16.onnx"}
WARM_RUNS = 5
# CPU is the fallback path: only its timing matters (rating uses DML masks),
# and one BiRefNet run there takes tens of seconds, so fewer runs and photos.
CPU_WARM_RUNS = 3
CPU_PHOTOS = 3
# A run that swaps or hangs past this is a "does not fit" result, not a timing.
COMBO_TIMEOUT_S = 600
ORT_LOG_ERRORS_ONLY = 3  # hides the harmless "can't constant fold" warnings
# A foreground share outside these bounds means an empty or all-white mask,
# the usual sign of a broken fp16 graph on a GPU.
SUSPECT_LOW, SUSPECT_HIGH = 0.002, 0.998

CSV_FIELDS = [
    "machine", "gpu", "model", "precision", "provider", "photo", "width", "height",
    "session_ms", "first_ms", "warm_ms", "infer_ms", "rss_mb", "commit_mb", "fg_share",
    "sigmoid", "suspect", "arena", "error",
]
PIL_RESAMPLE = {0: Image.Resampling.NEAREST, 1: Image.Resampling.LANCZOS,
                2: Image.Resampling.BILINEAR, 3: Image.Resampling.BICUBIC}


def load_preprocess(model_key):
    """Read size, rescale and normalization from the model's own config."""
    cfg = json.loads((MODELS_DIR / model_key / "preprocessor_config.json").read_text())
    return {
        "size": (cfg["size"]["width"], cfg["size"]["height"]),
        "resample": PIL_RESAMPLE[cfg.get("resample", 2)],
        "rescale": cfg.get("rescale_factor", 1 / 255) if cfg.get("do_rescale") else 1.0,
        "mean": np.array(cfg["image_mean"], np.float32) if cfg.get("do_normalize") else np.zeros(3, np.float32),
        "std": np.array(cfg["image_std"], np.float32) if cfg.get("do_normalize") else np.ones(3, np.float32),
    }


def open_photo(path):
    """Open as RGB in display orientation, the way the app shows it."""
    with Image.open(path) as img:
        return ImageOps.exif_transpose(img).convert("RGB")


def to_input(image, prep, dtype):
    resized = image.resize(prep["size"], prep["resample"])
    x = np.asarray(resized, np.float32) * prep["rescale"]
    x = (x - prep["mean"]) / prep["std"]
    return x.transpose(2, 0, 1)[None].astype(dtype)


def to_mask(raw, size):
    """First output -> float mask in [0, 1] at the photo's size."""
    m = np.asarray(raw, np.float32).reshape(raw.shape[-2:])
    needs_sigmoid = bool(m.min() < 0.0 or m.max() > 1.0)
    if needs_sigmoid:
        m = 1.0 / (1.0 + np.exp(-m))
    full = Image.fromarray(m, mode="F").resize(size, Image.Resampling.BICUBIC)
    return np.clip(np.asarray(full), 0.0, 1.0), needs_sigmoid


def save_outputs(image, mask, folder, stem):
    folder.mkdir(parents=True, exist_ok=True)
    alpha = Image.fromarray((mask * 255 + 0.5).astype(np.uint8), "L")
    alpha.save(folder / f"{stem}.mask.png")
    cut = image.copy()
    cut.putalpha(alpha)
    cut.save(folder / f"{stem}.cut.png", compress_level=1)
    for name, color in (("white", (255, 255, 255)), ("black", (0, 0, 0))):
        ground = Image.new("RGB", image.size, color)
        Image.composite(image, ground, alpha).save(folder / f"{stem}.{name}.jpg", quality=92)


def make_session(model_path, provider, arena=True):
    import onnxruntime as ort
    opts = ort.SessionOptions()
    opts.log_severity_level = ORT_LOG_ERRORS_ONLY
    # The CPU arena keeps freed blocks for reuse and the memory pattern
    # pre-plans one big block; with both off, BiRefNet fits a 16 GB laptop.
    opts.enable_cpu_mem_arena = arena
    if not arena:
        opts.enable_mem_pattern = False
    if provider == "DmlExecutionProvider":
        # DirectML does not support memory patterns or parallel execution.
        opts.enable_mem_pattern = False
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    return ort.InferenceSession(str(model_path), opts, providers=[provider])


def ms_since(start):
    return round((time.perf_counter() - start) * 1000, 1)


def run_one(args):
    """Child process: one model file on one provider over all photos."""
    model_path = MODELS_DIR / args.model / "onnx" / PRECISION_FILES[args.precision]
    provider = PROVIDERS[args.provider]
    prep = load_preprocess(args.model)
    photos = list_photos(Path(args.photos))
    warm_runs = WARM_RUNS
    if args.provider == "cpu":
        photos, warm_runs = photos[:args.cpu_photos], CPU_WARM_RUNS
    out_dir = Path(args.out)
    proc = psutil.Process()
    base = dict(machine=args.machine, gpu=args.gpu, model=args.model,
                precision=args.precision, provider=args.provider, arena=not args.no_arena)
    rows = []

    try:
        t = time.perf_counter()
        session = make_session(model_path, provider, arena=not args.no_arena)
        session_ms = ms_since(t)
        if session.get_providers()[0] != provider:
            raise RuntimeError(f"fell back to {session.get_providers()}")
        inp = session.get_inputs()[0]
        dtype = np.float16 if "float16" in inp.type else np.float32
    except Exception as exc:  # record the failure as a row and stop
        rows.append({**base, "photo": "*", "error": f"session: {exc}"[:300]})
        print(f"  {rows[-1]['error']}", flush=True)
        return write_rows(rows, out_dir)

    first_ms = warm_ms = None
    folder = out_dir / f"{args.model}-{args.precision}-{args.provider}"
    for i, photo in enumerate(photos):
        row = {**base, "photo": photo.name, "session_ms": session_ms}
        try:
            image = open_photo(photo)
            x = to_input(image, prep, dtype)
            t = time.perf_counter()
            raw = session.run(None, {inp.name: x})[0]
            infer_ms = ms_since(t)
            if i == 0:
                first_ms = infer_ms
                times = []
                for _ in range(warm_runs):
                    t = time.perf_counter()
                    session.run(None, {inp.name: x})
                    times.append(ms_since(t))
                warm_ms = statistics.median(times)
            mask, sigmoid = to_mask(raw, image.size)
            fg = float((mask > 0.5).mean())
            save_outputs(image, mask, folder, photo.stem)
            row.update(width=image.width, height=image.height, infer_ms=infer_ms,
                       fg_share=round(fg, 4), sigmoid=sigmoid,
                       suspect=not (SUSPECT_LOW <= fg <= SUSPECT_HIGH))
        except Exception as exc:
            row["error"] = str(exc)[:300]
        mem = proc.memory_info()
        # peak_wset: peak RAM in use; peak_pagefile: peak private commit (RAM + swap).
        row.update(first_ms=first_ms, warm_ms=warm_ms,
                   rss_mb=round(mem.peak_wset / 1e6), commit_mb=round(mem.peak_pagefile / 1e6))
        rows.append(row)
        print(f"  {photo.name}: {row.get('infer_ms')} ms fg={row.get('fg_share')} "
              f"{'SUSPECT ' if row.get('suspect') else ''}{row.get('error', '')}", flush=True)
    write_rows(rows, out_dir)


def write_rows(rows, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    results = out_dir / "results.csv"
    new = not results.exists()
    with results.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, CSV_FIELDS)
        if new:
            w.writeheader()
        w.writerows(rows)


def list_photos(folder):
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in PHOTO_EXTS)


def available(model_key):
    folder = MODELS_DIR / model_key / "onnx"
    return [p for p, f in PRECISION_FILES.items() if (folder / f).exists()]


def gpu_name():
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-CimInstance Win32_VideoController | Where-Object Name -notmatch 'DisplayLink|Basic').Name"],
            capture_output=True, text=True, timeout=30).stdout.strip()
        return out.replace("\r\n", " + ") or "unknown"
    except Exception:
        return "unknown"


def inspect(models):
    import onnxruntime as ort
    for key in models:
        prep = load_preprocess(key)
        print(f"== {key}: size={prep['size']} rescale={prep['rescale']:.6f} "
              f"mean={prep['mean'].tolist()} std={prep['std'].tolist()}")
        for precision in available(key):
            path = MODELS_DIR / key / "onnx" / PRECISION_FILES[precision]
            opts = ort.SessionOptions()
            opts.log_severity_level = ORT_LOG_ERRORS_ONLY
            s = ort.InferenceSession(str(path), opts, providers=["CPUExecutionProvider"])
            ins = [(i.name, i.shape, i.type) for i in s.get_inputs()]
            outs = [(o.name, o.shape, o.type) for o in s.get_outputs()]
            print(f"   {precision}: in={ins}\n          out={outs}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", default=["isnet", "birefnet_lite", "birefnet", "ben2"])
    ap.add_argument("--precisions", nargs="+", default=["fp32", "fp16"])
    ap.add_argument("--providers", nargs="+", default=["dml", "cpu"])
    ap.add_argument("--photos", default=str(ROOT / "photos"))
    ap.add_argument("--out", default=str(OUT_DIR), help="where masks and results.csv go")
    ap.add_argument("--cpu-photos", type=int, default=CPU_PHOTOS, help="photos per CPU run")
    ap.add_argument("--timeout", type=int, default=COMBO_TIMEOUT_S, help="seconds per model/provider run")
    ap.add_argument("--no-arena", action="store_true", help="turn off ORT's CPU memory arena")
    ap.add_argument("--machine", default=platform.node())
    ap.add_argument("--gpu", default=None)
    ap.add_argument("--inspect", action="store_true")
    ap.add_argument("--one", action="store_true", help=argparse.SUPPRESS)
    ap.add_argument("--model", help=argparse.SUPPRESS)
    ap.add_argument("--precision", help=argparse.SUPPRESS)
    ap.add_argument("--provider", help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.one:
        return run_one(args)
    if args.inspect:
        return inspect(args.models)

    gpu = args.gpu or gpu_name()
    if not list_photos(Path(args.photos)):
        sys.exit(f"no photos in {args.photos}")
    for key in args.models:
        for precision in [p for p in args.precisions if p in available(key)]:
            for provider in args.providers:
                print(f"{key} {precision} {provider}", flush=True)
                cmd = [sys.executable, __file__, "--one", "--model", key,
                       "--precision", precision, "--provider", provider,
                       "--photos", args.photos, "--out", args.out,
                       "--cpu-photos", str(args.cpu_photos),
                       "--machine", args.machine, "--gpu", gpu]
                if args.no_arena:
                    cmd.append("--no-arena")
                try:
                    subprocess.run(cmd, check=False, timeout=args.timeout)
                except subprocess.TimeoutExpired:
                    # subprocess.run kills the child; record why it has no rows.
                    print(f"  timeout after {args.timeout} s", flush=True)
                    write_rows([dict(machine=args.machine, gpu=gpu, model=key, precision=precision,
                                     provider=provider, photo="*",
                                     error=f"timeout after {args.timeout} s")], Path(args.out))


if __name__ == "__main__":
    main()
