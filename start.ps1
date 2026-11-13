# Startet den STL-Farbeditor unter Windows (Gegenstück zu start.sh).
# Nutzt Python, falls vorhanden; sonst einen eingebauten PowerShell-Webserver.
param([int]$Port = $(if ($env:PORT) { [int]$env:PORT } else { 8765 }), [switch]$NoPython)
$root = $PSScriptRoot
$url = "http://localhost:$Port/index.html"

# Echtes Python finden (der Microsoft-Store-Platzhalter "python.exe" zählt nicht)
function Find-Python {
  foreach ($c in @(@('py', '-3'), @('python'), @('python3'))) {
    $cmd = Get-Command $c[0] -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $cmd) { continue }
    $pre = @($c | Select-Object -Skip 1)
    try {
      & $cmd.Source @pre -c 'import http.server' 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { return @{ Exe = $cmd.Source; Pre = $pre } }
    } catch { }
  }
  return $null
}

$py = if ($NoPython) { $null } else { Find-Python }
if ($py) {
  & $py.Exe @($py.Pre) (Join-Path $root 'server.py') $Port --open
  exit $LASTEXITCODE
}

# ---- Fallback ohne Python: kleiner Webserver mit HttpListener ----
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'
  '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'; '.wasm' = 'application/wasm'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try { $listener.Start() } catch {
  Write-Host "Port $Port ist belegt oder nicht verfügbar. Anderen Port wählen: start.bat -Port 8766" -ForegroundColor Red
  exit 1
}
$rootFull = [System.IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
Write-Host "STL-Farbeditor läuft auf $url  (Beenden mit Strg+C)"
Start-Process $url
try {
  while ($listener.IsListening) {
    $async = $listener.BeginGetContext($null, $null)
    while (-not $async.AsyncWaitHandle.WaitOne(250)) { }  # Warten in kleinen Schritten, damit Strg+C greift
    $ctx = $listener.EndGetContext($async)
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $file = [System.IO.Path]::GetFullPath((Join-Path $rootFull ($rel -replace '/', '\')))
      if ($file.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $file -PathType Leaf)) {
        $bytes = [System.IO.File]::ReadAllBytes($file)
        $ext = [System.IO.Path]::GetExtension($file).ToLower()
        $res.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
        $res.Headers.Add('Cache-Control', 'no-cache')
        $res.ContentLength64 = $bytes.Length
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch { $res.StatusCode = 500 }
    finally { try { $res.Close() } catch { } }
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
