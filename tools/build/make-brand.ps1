# Generates every brand asset from tools\build\brand\logo.png (the official product logo):
#   public\img\nova-icon-{16..512}.png   circular PNGs (favicon, manifest, default shortcut icon)
#   public\img\nova.ico, installer\assets\nova.ico
#   tools\keygen\keygen.ico, keygen-256.png (logo + key badge, for the license tool)
# Run:  powershell -ExecutionPolicy Bypass -File tools\build\make-brand.ps1
Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$src = [System.Drawing.Image]::FromFile((Join-Path $PSScriptRoot 'brand\logo.png'))

function New-Circular([int]$size, [double]$zoom) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'; $g.CompositingQuality = 'HighQuality'
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddEllipse(0, 0, $size - 1, $size - 1)
  $g.SetClip($path)
  $d = $size * $zoom; $o = ($size - $d) / 2
  $g.DrawImage($src, [single]$o, [single]$o, [single]$d, [single]$d)
  $g.Dispose()
  return $bmp
}
function Get-PngBytes($bmp) { $ms = New-Object System.IO.MemoryStream; $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); return ,$ms.ToArray() }

function Write-Ico([string]$file, $pngs) {   # $pngs: ordered hashtable size -> bytes (PNG-in-ICO)
  $sizes = @($pngs.Keys | Sort-Object)
  $ms = New-Object System.IO.MemoryStream; $w = New-Object System.IO.BinaryWriter $ms
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
  $off = 6 + 16 * $sizes.Count
  foreach ($s in $sizes) {
    $b = [byte]($(if ($s -ge 256) { 0 } else { $s }))
    $w.Write($b); $w.Write($b); $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$pngs[$s].Length); $w.Write([uint32]$off); $off += $pngs[$s].Length
  }
  foreach ($s in $sizes) { $w.Write($pngs[$s]) }
  [System.IO.File]::WriteAllBytes($file, $ms.ToArray())
}

# 1) circular brand PNGs + nova.ico  (zoom 1.06 crops the thin outer rim so the circle edge is clean)
$imgDir = Join-Path $root 'public\img'
New-Item -ItemType Directory -Force $imgDir | Out-Null
$icoSet = @{}
foreach ($s in 16, 32, 48, 64, 128, 192, 256, 512) {
  $b = New-Circular $s 1.06
  $bytes = Get-PngBytes $b
  [System.IO.File]::WriteAllBytes((Join-Path $imgDir "nova-icon-$s.png"), $bytes)
  if ($s -in 16, 32, 48, 64, 128, 256) { $icoSet[$s] = $bytes }
  $b.Dispose()
}
Write-Ico (Join-Path $imgDir 'nova.ico') $icoSet
Copy-Item (Join-Path $imgDir 'nova.ico') (Join-Path $root 'installer\assets\nova.ico') -Force

# 2) license-tool icon: circular logo + dark key badge (bottom-right)
function New-KeyIcon([int]$size) {
  $bmp = New-Circular $size 1.06
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $cx = $size * 0.72; $cy = $size * 0.72; $r = $size * 0.26
  $ring = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 231, 194, 120))
  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 44, 16, 40))
  $g.FillEllipse($ring, [single]($cx - $r), [single]($cy - $r), [single]($r * 2), [single]($r * 2))
  $r2 = $r * 0.88
  $g.FillEllipse($dark, [single]($cx - $r2), [single]($cy - $r2), [single]($r2 * 2), [single]($r2 * 2))
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 243, 209, 130)), ([single]([math]::Max(1.2, $size * 0.04)))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'
  $k = 0.7071
  $kx = $cx - $r * 0.34; $ky = $cy - $r * 0.34; $kr = $r * 0.24
  $g.DrawEllipse($pen, [single]($kx - $kr), [single]($ky - $kr), [single]($kr * 2), [single]($kr * 2))
  $sx = $kx + $kr * $k; $sy = $ky + $kr * $k; $ex = $cx + $r * 0.46; $ey = $cy + $r * 0.46
  $g.DrawLine($pen, [single]$sx, [single]$sy, [single]$ex, [single]$ey)
  foreach ($t in 0.62, 0.86) {
    $px = $sx + ($ex - $sx) * $t; $py = $sy + ($ey - $sy) * $t
    $g.DrawLine($pen, [single]$px, [single]$py, [single]($px + $r * 0.24 * $k * 1), [single]($py - $r * 0.24 * $k))
  }
  $g.Dispose()
  return $bmp
}
$kdir = Join-Path $root 'tools\keygen'
$kset = @{}
foreach ($s in 16, 32, 48, 64, 128, 256) {
  $b = New-KeyIcon $s; $bytes = Get-PngBytes $b; $kset[$s] = $bytes
  if ($s -eq 256) { [System.IO.File]::WriteAllBytes((Join-Path $kdir 'keygen-256.png'), $bytes) }
  $b.Dispose()
}
Write-Ico (Join-Path $kdir 'keygen.ico') $kset
$src.Dispose()
Write-Output 'brand assets generated'
