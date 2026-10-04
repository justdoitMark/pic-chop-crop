# Sample GPU memory of all python.exe processes until stopped (Ctrl+C) or
# until -Seconds pass. Prints one line per sample when the peak grows, and
# the peak per process at the end.
#   powershell -File gpu_mem.ps1 -Seconds 600
param([int]$Seconds = 600, [int]$IntervalSec = 1)

$peak = @{}
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
    $pids = @(Get-Process python -ErrorAction SilentlyContinue | ForEach-Object Id)
    if ($pids.Count -gt 0) {
        $samples = (Get-Counter '\GPU Process Memory(*)\Dedicated Usage', '\GPU Process Memory(*)\Shared Usage' -ErrorAction SilentlyContinue).CounterSamples
        # A process can have one instance per adapter (luid): sum them per sample.
        $now = @{}
        foreach ($s in $samples) {
            if ($s.InstanceName -notmatch '^pid_(\d+)_') { continue }
            $procId = [int]$Matches[1]
            if ($pids -notcontains $procId) { continue }
            $kind = if ($s.Path -like '*dedicated*') { 'dedicated' } else { 'shared' }
            $now["$procId $kind"] += $s.CookedValue
        }
        foreach ($key in $now.Keys) {
            $procId, $kind = $key -split ' '
            $mb = [math]::Round($now[$key] / 1MB)
            if (-not $peak.ContainsKey($key) -or $mb -gt $peak[$key]) {
                $peak[$key] = $mb
                "{0:HH:mm:ss} pid {1} {2} {3} MB" -f (Get-Date), $procId, $kind, $mb
            }
        }
    }
    Start-Sleep -Seconds $IntervalSec
}
"--- peak per process ---"
$peak.GetEnumerator() | Sort-Object Name | ForEach-Object { "{0}: {1} MB" -f $_.Name, $_.Value }
