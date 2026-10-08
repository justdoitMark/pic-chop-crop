"""BiRefNet on DirectML with and without DML graph fusion, on the synthetic photo.

    python stage_e/dml_session.py fusion|nofusion|basic [model.onnx|model_fp16.onnx]

Prints session time, 8 run times, foreground share and the process's GPU memory
after the runs (the DML allocator keeps its peak, so this is the peak; a 1-s
sampler like gpu_mem.ps1 can miss short-lived processes).
"""
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import numpy as np  # noqa: E402
import onnxruntime as ort  # noqa: E402

import bench  # noqa: E402

GPU_MEM_PS = ("$c=(Get-Counter '\\GPU Process Memory(pid_{0}_*)\\Dedicated Usage',"
              "'\\GPU Process Memory(pid_{0}_*)\\Shared Usage').CounterSamples;"
              "'dedicated {{0:N0}} MB, shared {{1:N0}} MB' -f "
              "(($c|?{{$_.Path -like '*dedicated*'}}|Measure-Object CookedValue -Sum).Sum/1MB), "
              "(($c|?{{$_.Path -like '*shared*'}}|Measure-Object CookedValue -Sum).Sum/1MB)")


def main():
    variant = sys.argv[1]
    model_file = sys.argv[2] if len(sys.argv) > 2 else "model.onnx"
    opts = ort.SessionOptions()
    opts.log_severity_level = 3
    opts.enable_mem_pattern = False
    opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    if variant == "nofusion":
        opts.add_session_config_entry("ep.dml.disable_graph_fusion", "1")
    if variant == "basic":
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    t = time.perf_counter()
    session = ort.InferenceSession(str(ROOT / "models" / "birefnet" / "onnx" / model_file), opts,
                                   providers=["DmlExecutionProvider"])
    session_ms = (time.perf_counter() - t) * 1000
    image = bench.open_photo(ROOT / "out" / "synthetic" / "plain.jpg")
    x = bench.to_input(image, bench.load_preprocess("birefnet"), np.float32)
    name = session.get_inputs()[0].name
    times = []
    try:
        for _ in range(8):
            t = time.perf_counter()
            raw = session.run(None, {name: x})[0]
            times.append((time.perf_counter() - t) * 1000)
        mask, _ = bench.to_mask(raw, image.size)
        print(f"{variant} {model_file}: OK session {session_ms:.0f} ms, runs {[round(v) for v in times]} ms, "
              f"fg {(mask > 0.5).mean():.4f}")
    except Exception as exc:
        print(f"{variant} {model_file}: FAIL session {session_ms:.0f} ms after {len(times)} runs: {str(exc)[:160]}")
    mem = subprocess.run(["powershell", "-NoProfile", "-Command", GPU_MEM_PS.format(os.getpid())],
                         capture_output=True, text=True).stdout.strip()
    print(f"  after runs: {mem}")


if __name__ == "__main__":
    main()
