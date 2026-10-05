# Background removal spike

Throwaway code for the plan in `docs/superpowers/plans/2026-10-04-bg-removal-spike.md`.
Nothing here ships in the app. Results and decisions: `RESULTS.md`.

Photos stay on this machine: `photos/`, `models/`, `out/` and `dll/` are git-ignored.
The scripts only read local files; `fetch_models.py` downloads public models from
Hugging Face once.

## Python (stages A–C)

Windows, Python 3.13:

```powershell
cd spikes\bg-removal
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -c "import onnxruntime as o; print(o.get_available_providers())"  # expect DmlExecutionProvider

.\.venv\Scripts\python fetch_models.py          # ~2.2 GB into models/
.\.venv\Scripts\python bench.py --inspect       # inputs/outputs + preprocessing per model

# pipeline self-check on synthetic photos with a known mask
.\.venv\Scripts\python make_synthetic.py
.\.venv\Scripts\python bench.py --photos out/synthetic --out out/synthetic-run --models isnet
.\.venv\Scripts\python check_synthetic.py       # exits 1 if any IoU < 0.9

# real run: put photos into photos/ first
.\.venv\Scripts\python bench.py --providers dml
.\.venv\Scripts\python bench.py --providers cpu --no-arena
powershell -File gpu_mem.ps1 -Seconds 1800      # in a second window: GPU memory per python process

.\.venv\Scripts\python clean.py --time                          # edge clean-up timing, 12 / 24 MP
.\.venv\Scripts\python clean.py <run> <run>                     # e.g. birefnet-fp32-cpu -> out/<run>-clean/
.\.venv\Scripts\python sheet.py --columns <run> <run> ...       # -> out/sheet.html (blind rating, one photo per screen)
.\.venv\Scripts\python sheet.py --name clean --columns <run>-clean ...   # -> out/sheet-clean.html, own ratings store
.\.venv\Scripts\python tally.py out\ratings.json out\ratings-clean.json  # Markdown tables for RESULTS.md
```

The sheet page is `sheet_template.html`; ratings stay in the browser
(localStorage) until "Сохранить оценки" writes `ratings*.json` to Downloads.
Keep the same `--columns` order to keep the same letters.

`bench.py` runs each model × precision × provider in its own process (clean
peak memory and first-load time) with a 10-minute limit, and appends rows to
`out/results.csv`. On CPU it times only the first 3 photos (`--cpu-photos`).

## Rust `ort` (stage D)

GNU toolchain works through `load-dynamic` (no link step against ONNX Runtime).
`libloading` needs `dlltool`, so a full MinGW (e.g. WinLibs) goes first in PATH.
Build outside any path with `&` in it:

```powershell
$env:PATH = "C:\ClaudeUser\mingw64\bin;$env:PATH"    # wherever WinLibs lives
$env:CARGO_TARGET_DIR = "C:\pcc-target"
cargo build --release --manifest-path rs\Cargo.toml
Copy-Item dll\*.dll C:\pcc-target\release\    # DirectML.dll must sit next to the exe
C:\pcc-target\release\bg-remove-rs.exe models\<key>\onnx\<file>.onnx photos\<photo> out\rs\<photo>.mask.png [--cpu [--no-arena]]
.\.venv\Scripts\python compare.py out\rs <run>                 # share of pixels off by > 8/255
powershell -File ab_time.ps1 -Model isnet -Provider dml        # Rust vs Python, alternating rounds
```

The first DirectML session of a new exe compiles shaders (~1 min on Iris Xe);
time the second run. BiRefNet on CPU needs `--no-arena` (no arena, no memory
pattern) to fit a 16 GB laptop.

`dll/` holds `onnxruntime.dll` from NuGet `Microsoft.ML.OnnxRuntime.DirectML` 1.24.4
and `DirectML.dll` from `Microsoft.AI.DirectML` 1.15.4 (`bin/x64-win`).
