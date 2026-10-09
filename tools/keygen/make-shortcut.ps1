# Creates the "أداة ترخيص محلات التجميل" desktop shortcut (run once on the developer machine).
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$name = [string]::Join('', [char[]](0x0623,0x062F,0x0627,0x0629,0x20,0x062A,0x0631,0x062E,0x064A,0x0635,0x20,0x0645,0x062D,0x0644,0x0627,0x062A,0x20,0x0627,0x0644,0x062A,0x062C,0x0645,0x064A,0x0644))
$desktop = [Environment]::GetFolderPath('Desktop')
$sh = New-Object -ComObject WScript.Shell
$l = $sh.CreateShortcut((Join-Path $desktop ($name + '.lnk')))
$l.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$l.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dir\launch-keygen.ps1`""
$l.WorkingDirectory = $dir
$l.IconLocation = "$dir\keygen.ico,0"
$l.WindowStyle = 7
$l.Description = $name
$l.Save()
& "$env:SystemRoot\System32\ie4uinit.exe" -show
Write-Output ('created: ' + (Join-Path $desktop ($name + '.lnk')))
