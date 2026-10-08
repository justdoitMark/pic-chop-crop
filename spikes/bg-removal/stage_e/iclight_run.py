"""IC-Light (fc) relight through a local ComfyUI server (127.0.0.1 only).

ComfyUI portable lives outside the repo (C:/AI-Workspace/sandbox/iclight), started with
`main.py --listen 127.0.0.1 --offline` (no partner/API nodes); models: SD1.5 checkpoint
in models/checkpoints, iclight_sd15_fc in models/unet/IC-Light, nodes from kijai/ComfyUI-IC-Light.

    python stage_e/iclight_run.py prep <cut.png> <out_dir> [--long 768]
        -> <out_dir>/<stem>_fg.png: subject bbox crop on 50 % gray, long side --long (multiple of 64)
    python stage_e/iclight_run.py run <fg.png file name in ComfyUI/input> <prefix> --prompt "..." [--light "Left Light"] [--seed 1] --input-dir <ComfyUI/input>
        -> queues one prompt, waits, prints output file names (ComfyUI/output/<prefix>_*.png)

Graph: checkpoint (SD1.5) -> IC-Light fc unet -> ICLightConditioning(foreground latent)
-> KSampler on a light-gradient latent -> VAEDecode -> SaveImage, plus a DetailTransfer
variant (high frequencies from the input put back), as kijai's examples do.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SERVER = "http://127.0.0.1:8188"
CKPT = "Realistic_Vision_V5.1_fp16-no-ema.safetensors"
ICLIGHT = r"IC-Light\iclight_sd15_fc.safetensors"
SAMPLER = ["dpmpp_2m", "karras"]
NEGATIVE = "lowres, bad anatomy, bad hands, cropped, worst quality, blurry, deformed"


def prep(cut_path, out_dir, long_side):
    from PIL import Image
    cut = Image.open(cut_path).convert("RGBA")
    alpha = cut.getchannel("A")
    box = alpha.point(lambda v: 255 if v > 127 else 0).getbbox()
    w, h = box[2] - box[0], box[3] - box[1]
    pad = int(max(w, h) * 0.06)
    box = (max(box[0] - pad, 0), max(box[1] - pad, 0),
           min(box[2] + pad, cut.width), min(box[3] + pad, cut.height))
    crop = cut.crop(box)
    gray = Image.new("RGBA", crop.size, (127, 127, 127, 255))
    fg = Image.alpha_composite(gray, crop).convert("RGB")
    scale = long_side / max(fg.size)
    size = tuple(max(64, round(v * scale / 64) * 64) for v in fg.size)
    fg = fg.resize(size, Image.Resampling.LANCZOS)
    out = Path(out_dir) / f"{Path(cut_path).name.split('.')[0]}_fg.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    fg.save(out)
    print(out, fg.size)


def graph(fg_name, width, height, prompt, light, seed, prefix):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "2": {"class_type": "LoadAndApplyICLightUnet", "inputs": {"model": ["1", 0], "model_path": ICLIGHT}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": prompt}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": NEGATIVE}},
        "5": {"class_type": "LoadImage", "inputs": {"image": fg_name}},
        "6": {"class_type": "VAEEncode", "inputs": {"pixels": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "ICLightConditioning",
              "inputs": {"positive": ["3", 0], "negative": ["4", 0], "vae": ["1", 2],
                         "foreground": ["6", 0], "multiplier": 0.18215}},
        "8": {"class_type": "LightSource",
              "inputs": {"light_position": light, "multiplier": 1.0, "start_color": "#FFFFFF",
                         "end_color": "#000000", "width": width, "height": height}},
        "9": {"class_type": "VAEEncode", "inputs": {"pixels": ["8", 0], "vae": ["1", 2]}},
        "10": {"class_type": "KSampler",
               "inputs": {"model": ["2", 0], "positive": ["7", 0], "negative": ["7", 1],
                          "latent_image": ["9", 0], "seed": seed, "steps": 25, "cfg": 2.0,
                          "sampler_name": SAMPLER[0], "scheduler": SAMPLER[1], "denoise": 0.9}},
        "11": {"class_type": "VAEDecode", "inputs": {"samples": ["10", 0], "vae": ["1", 2]}},
        "12": {"class_type": "SaveImage", "inputs": {"images": ["11", 0], "filename_prefix": f"{prefix}_raw"}},
        "13": {"class_type": "DetailTransfer",
               "inputs": {"target": ["11", 0], "source": ["5", 0], "mode": "add",
                          "blur_sigma": 1.0, "blend_factor": 1.0}},
        "14": {"class_type": "SaveImage", "inputs": {"images": ["13", 0], "filename_prefix": f"{prefix}_detail"}},
    }


def post(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(SERVER + path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"{e.code} from {path}: {e.read().decode()[:3000]}")


def run(fg_name, prefix, prompt, light, seed, input_dir):
    from PIL import Image
    width, height = Image.open(Path(input_dir) / fg_name).size
    t = time.perf_counter()
    try:
        pid = post("/prompt", {"prompt": graph(fg_name, width, height, prompt, light, seed, prefix)})["prompt_id"]
    except ConnectionResetError:
        # the server got the prompt but the reply was cut: take the newest queued prompt
        time.sleep(1)
        pid = next(iter(post("/history?max_items=1")), None) or post("/queue")["queue_running"][0][1]
        print(f"  reply lost, using prompt {pid}")
    while True:
        time.sleep(0.5)
        try:
            hist = post(f"/history/{pid}")
        except (ConnectionResetError, urllib.error.URLError) as e:
            print(f"  poll retry: {e!r}"[:120])
            continue
        if pid in hist:
            break
    status = hist[pid]["status"]
    files = [i["filename"] for o in hist[pid]["outputs"].values() for i in o.get("images", [])]
    print(f"{prefix}: {status.get('status_str')} in {time.perf_counter() - t:.1f} s, {width}x{height} -> {files}")
    if status.get("status_str") != "success":
        print(json.dumps(status.get("messages"), indent=1)[:2000])
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["prep", "run"])
    ap.add_argument("a")
    ap.add_argument("b")
    ap.add_argument("--long", type=int, default=768)
    ap.add_argument("--prompt", default="")
    ap.add_argument("--light", default="Left Light")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--input-dir", default="")
    ap.add_argument("--sampler", nargs=2, default=None, help="sampler scheduler, e.g. euler ddim_uniform")
    args = ap.parse_args()
    if args.sampler:
        SAMPLER[:] = args.sampler
    if args.cmd == "prep":
        prep(args.a, args.b, args.long)
    else:
        run(args.a, args.b, args.prompt, args.light, args.seed, args.input_dir)


if __name__ == "__main__":
    main()
