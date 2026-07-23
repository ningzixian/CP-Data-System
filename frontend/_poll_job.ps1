# _poll_job.ps1 - poll a job until done
$jobId = $args[0]
if (-not $jobId) {
  Write-Host "Usage: _poll_job.ps1 <jobId>"
  exit 1
}
$start = Get-Date
$epoch = [DateTime]"1970-01-01"
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep 3
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:5174/api/sql/field/job?id=$jobId" -UseBasicParsing -TimeoutSec 5
    $j = $r.Content | ConvertFrom-Json
    $elapsed = [int]((Get-Date) - $start).TotalSeconds
    Write-Host ("T+" + $elapsed + "s  status=" + $j.status + "  output_lines=" + $j.output.Count)
    if ($j.status -ne "running") {
      Write-Host "=== FINAL OUTPUT ==="
      $j.output | ForEach-Object { Write-Host ("  " + $_) }
      Write-Host "=== RESULT ==="
      Write-Host ($j | ConvertTo-Json -Depth 2)
      exit 0
    }
  } catch {
    Write-Host ("ERROR: " + $_.Exception.Message)
  }
}
Write-Host "TIMEOUT after 120s"
exit 1
