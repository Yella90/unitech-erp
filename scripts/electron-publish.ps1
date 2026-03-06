$ErrorActionPreference = "Stop"

if (-not $env:GH_TOKEN) { throw "GH_TOKEN is required" }


$distScript = Join-Path $PSScriptRoot "electron-dist.ps1"

& $distScript `
  --publish always `
  "-c.publish.provider=github" `
  "-c.publish.owner=Yella90" `
  "-c.publish.repo=unitech-erp" `
  "-c.publish.releaseType=release"

if ($LASTEXITCODE -ne 0) { throw "electron publish failed" }
