param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$BuilderArgs
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"
$mainJs = Join-Path $projectRoot "public\js\main.js"
$uiJs = Join-Path $projectRoot "public\js\ui.js"
$packageJsonPath = Join-Path $projectRoot "package.json"

function Import-DotEnvFile {
  param(
    [string]$Path
  )

  if (-not (Test-Path $Path)) { return }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }

    $separatorIndex = $line.IndexOf("=")
    if ($separatorIndex -lt 1) { return }

    $name = $line.Substring(0, $separatorIndex).Trim()
    $value = $line.Substring($separatorIndex + 1).Trim()

    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if (-not [string]::IsNullOrWhiteSpace($name) -and -not (Test-Path "Env:$name")) {
      Set-Item -Path "Env:$name" -Value $value
    }
  }
}

Import-DotEnvFile -Path $envFile

$tmpDir = Join-Path $env:TEMP ("unitech-obf-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tmpDir | Out-Null
$mainBackup = Join-Path $tmpDir "main.js.bak"
$uiBackup = Join-Path $tmpDir "ui.js.bak"
$packageBackup = Join-Path $tmpDir "package.json.bak"

Copy-Item $mainJs $mainBackup -Force
Copy-Item $uiJs $uiBackup -Force
Copy-Item $packageJsonPath $packageBackup -Force

function Set-PackagedRuntimeConfig {
  $package = Get-Content $packageJsonPath -Raw | ConvertFrom-Json

  if (-not $package.build) {
    throw "package.json build config is missing"
  }

  if (-not $package.build.extraMetadata) {
    $package.build | Add-Member -NotePropertyName "extraMetadata" -NotePropertyValue ([pscustomobject]@{})
  }

  $runtimeConfig = [pscustomobject]@{
    electronUpdateProvider = [string]($env:ELECTRON_UPDATE_PROVIDER)
    electronUpdateUrl = [string]($env:ELECTRON_UPDATE_URL)
    ghOwner = [string]($env:GH_OWNER)
    ghRepo = [string]($env:GH_REPO)
  }

  if ($package.build.extraMetadata.unitechRuntime) {
    $package.build.extraMetadata.unitechRuntime = $runtimeConfig
  } else {
    $package.build.extraMetadata | Add-Member -NotePropertyName "unitechRuntime" -NotePropertyValue $runtimeConfig
  }

  $json = $package | ConvertTo-Json -Depth 100
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($packageJsonPath, $json, $utf8NoBom)
}

try {
  Set-PackagedRuntimeConfig
  & node (Join-Path $projectRoot "scripts\obfuscate-js.js")
  if ($LASTEXITCODE -ne 0) { throw "obfuscate-js failed" }

  $defaultArgs = @("--win", "nsis", "--config.win.signAndEditExecutable=false")
  $allArgs = $defaultArgs + $BuilderArgs
  & (Join-Path $projectRoot "node_modules\.bin\electron-builder.cmd") @allArgs
  if ($LASTEXITCODE -ne 0) { throw "electron-builder failed" }
}
finally {
  Copy-Item $mainBackup $mainJs -Force
  Copy-Item $uiBackup $uiJs -Force
  Copy-Item $packageBackup $packageJsonPath -Force
  Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
}
