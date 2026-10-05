# Rust vs Python warm timing on one photo, alternating runs so both see the
# same machine state. Prints one line per run; compare the medians.
#   powershell -File ab_time.ps1 -Model isnet -File model.onnx -Photo out\synthetic\plain.jpg -Provider dml
param(
    [string]$Model = "isnet",
    [string]$File = "model.onnx",
    [string]$Photo = "out\synthetic\plain.jpg",
    [ValidateSet("dml", "cpu")][string]$Provider = "dml",
    [int]$Rounds = 3,
    [switch]$NoArena,
    [string]$Exe = "C:\pcc-target\release\bg-remove-rs.exe"
)
$precision = if ($File -like "*fp16*") { "fp16" } else { "fp32" }
$work = "out\ab\$Model-$precision-$Provider"
New-Item -ItemType Directory -Force "$work\photo", "$work\rs" | Out-Null
Copy-Item $Photo "$work\photo\"
$rsArgs = @("models\$Model\onnx\$File", $Photo, "$work\rs\$([IO.Path]::GetFileNameWithoutExtension($Photo)).mask.png")
if ($Provider -eq "cpu") { $rsArgs += "--cpu" }
$pyExtra = @()
if ($NoArena) { $rsArgs += "--no-arena"; $pyExtra += "--no-arena" }

for ($i = 1; $i -le $Rounds; $i++) {
    $rs = & $Exe @rsArgs 2>$null
    "rust   round $i  $rs"
    Remove-Item "$work\py" -Recurse -Force -ErrorAction SilentlyContinue
    & .\.venv\Scripts\python.exe bench.py --one --model $Model --precision $precision --provider $Provider `
        --photos "$work\photo" --out "$work\py" --cpu-photos 1 --machine ab --gpu ab @pyExtra 2>$null | Out-Null
    $row = Import-Csv "$work\py\results.csv" | Select-Object -First 1
    "python round $i  session_ms=$($row.session_ms) first_ms=$($row.first_ms) warm_ms=$($row.warm_ms)"
}
