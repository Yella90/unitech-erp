$ErrorActionPreference = "Stop"

if (!(Get-Command "pg_dump" -ErrorAction SilentlyContinue)) {
  throw "pg_dump is required and not found in PATH."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$backupRoot = Join-Path $projectRoot "backups\postgres"
if (!(Test-Path $backupRoot)) {
  New-Item -Path $backupRoot -ItemType Directory | Out-Null
}

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $backupRoot "postgres-$stamp.dump"

$hostName = if ($env:PGHOST) { $env:PGHOST } else { "localhost" }
$port = if ($env:PGPORT) { $env:PGPORT } else { "5432" }
$user = if ($env:PGUSER) { $env:PGUSER } else { "postgres" }
$db = if ($env:PGDATABASE) { $env:PGDATABASE } else { "unitech_erp" }

pg_dump -h $hostName -p $port -U $user -Fc -f $dest $db

Write-Host "PostgreSQL backup created: $dest"
