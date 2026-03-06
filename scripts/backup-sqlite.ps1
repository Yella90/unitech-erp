$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$dbPath = Join-Path $projectRoot "database.sqlite"
$backupRoot = Join-Path $projectRoot "backups\sqlite"

if (!(Test-Path $dbPath)) {
  throw "SQLite database not found: $dbPath"
}

if (!(Test-Path $backupRoot)) {
  New-Item -Path $backupRoot -ItemType Directory | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $backupRoot "database-$stamp.sqlite"
Copy-Item -Path $dbPath -Destination $dest -Force

Write-Host "SQLite backup created: $dest"
