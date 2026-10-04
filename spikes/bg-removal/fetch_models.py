"""Download the spike's ONNX models from Hugging Face into models/<key>/.

Run once; files already in models/ are not downloaded again.
Nothing is uploaded: this only reads public model repos.
"""
from pathlib import Path

from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parent
MODELS_DIR = ROOT / "models"

# key -> (repo, ONNX files to fetch). fp16 and fp32 where the repo has both.
MODELS = {
    "isnet": ("onnx-community/ISNet-ONNX", ["onnx/model.onnx", "onnx/model_fp16.onnx"]),
    "birefnet_lite": ("onnx-community/BiRefNet_lite-ONNX", ["onnx/model.onnx", "onnx/model_fp16.onnx"]),
    "birefnet": ("onnx-community/BiRefNet-ONNX", ["onnx/model.onnx", "onnx/model_fp16.onnx"]),
    "ben2": ("onnx-community/BEN2-ONNX", ["onnx/model_fp16.onnx"]),
}
CONFIG_FILES = ["preprocessor_config.json", "config.json"]


def fetch(key, repo, files):
    """Download straight into models/<key>/ (keeps the repo's onnx/ subfolder)."""
    target = MODELS_DIR / key
    for name in CONFIG_FILES + files:
        dest = Path(hf_hub_download(repo, name, local_dir=target))
        print(f"  {dest.relative_to(ROOT)} ({dest.stat().st_size / 1e6:.1f} MB)")


def main():
    for key, (repo, files) in MODELS.items():
        print(f"{key}: {repo}")
        fetch(key, repo, files)


if __name__ == "__main__":
    main()
