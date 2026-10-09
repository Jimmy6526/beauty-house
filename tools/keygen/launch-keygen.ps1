# Launches the license tool silently: starts the local server (hidden) if needed, then opens an app-style window.
$ErrorActionPreference = 'SilentlyContinue'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = 'http://127.0.0.1:5199'
$listening = Get-NetTCPConnection -LocalPort 5199 -State Listen -ErrorAction SilentlyContinue
if (-not $listening) {
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
  Start-Process -FilePath $node -ArgumentList 'keygen.js', 'ui', '--auto-exit' -WorkingDirectory $dir -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 250; if (Get-NetTCPConnection -LocalPort 5199 -State Listen -ErrorAction SilentlyContinue) { break } }
}
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
if (Test-Path $edge) { Start-Process $edge "--app=$url" }
elseif (Test-Path $chrome) { Start-Process $chrome "--app=$url" }
else { Start-Process $url }
