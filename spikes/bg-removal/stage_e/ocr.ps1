# Windows built-in OCR (Windows.Media.Ocr, offline) -> JSON with lines and word boxes.
#   powershell -File stage_e\ocr.ps1 -Image out\x.png -Out out\x.ocr.json [-Lang en-US]
# Used as a text-fidelity metric and as a text mask for IC-Light; nothing leaves the machine.
param([Parameter(Mandatory)][string]$Image, [Parameter(Mandatory)][string]$Out, [string]$Lang = "en-US")

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($op, [type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
    $task.Wait(-1) | Out-Null
    $task.Result
}

$path = (Resolve-Path $Image).Path
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($Lang))
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()

$lines = foreach ($line in $result.Lines) {
    [pscustomobject]@{
        text  = $line.Text
        words = @(foreach ($w in $line.Words) {
            $r = $w.BoundingRect
            [pscustomobject]@{ text = $w.Text; x = $r.X; y = $r.Y; w = $r.Width; h = $r.Height }
        })
    }
}
[pscustomobject]@{ image = $path; lines = @($lines) } | ConvertTo-Json -Depth 5 | Out-File -Encoding utf8 $Out
