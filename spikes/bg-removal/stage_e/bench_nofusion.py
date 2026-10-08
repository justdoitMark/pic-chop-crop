"""bench.py's DML run of BiRefNet with DirectML graph fusion turned off.

    python stage_e/bench_nofusion.py fp32|fp16    # -> out/nofusion/birefnet-<precision>-dml/ + results.csv

With fusion (ORT's default) BiRefNet fp32 fails on the RTX 5090 in a fused DML
node (887A0001, then the device is removed); without it, it runs.
"""
import argparse
import platform
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import onnxruntime as ort  # noqa: E402

import bench  # noqa: E402

_make_session = bench.make_session


def make_session(model_path, provider, arena=True):
    """bench.make_session, plus the fusion switch on the SessionOptions it builds."""
    real_init = ort.InferenceSession.__init__

    def init(self, path, opts=None, *args, **kwargs):
        opts.add_session_config_entry("ep.dml.disable_graph_fusion", "1")
        real_init(self, path, opts, *args, **kwargs)

    ort.InferenceSession.__init__ = init
    try:
        return _make_session(model_path, provider, arena)
    finally:
        ort.InferenceSession.__init__ = real_init


def main():
    bench.make_session = make_session
    bench.run_one(argparse.Namespace(
        model="birefnet", precision=sys.argv[1], provider="dml", photos=str(ROOT / "photos"),
        out=str(ROOT / "out" / "nofusion"), cpu_photos=3, machine=platform.node(),
        gpu=bench.gpu_name(), no_arena=False))


if __name__ == "__main__":
    main()
