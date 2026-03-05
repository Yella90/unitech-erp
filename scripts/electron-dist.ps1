$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$mainJs = Join-Path $projectRoot "public\js\main.js"
$uiJs = Join-Path $projectRoot "public\js\ui.js"

$tmpDir = Join-Path $env:TEMP ("unitech-obf-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir | Out-Null
$mainBackup = Join-Path $tmpDir "main.js.bak"
$uiBackup = Join-Path $tmpDir "ui.js.bak"

Copy-Item $mainJs $mainBackup -Force
Copy-Item $uiJs $uiBackup -Force

try {
  & node (Join-Path $projectRoot "scripts\obfuscate-js.js")
  if ($LASTEXITCODE -ne 0) { throw "obfuscate-js failed" }

  & (Join-Path $projectRoot "node_modules\.bin\electron-builder.cmd") --win nsis --config.win.signAndEditExecutable=false
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
}
finally {
  Copy-Item $mainBackup $mainJs -Force
  Copy-Item $uiBackup $uiJs -Force
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
