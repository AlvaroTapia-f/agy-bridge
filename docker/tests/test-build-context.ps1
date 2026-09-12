$ErrorActionPreference = 'Stop'

$tag = "agy-bridge-context-test-$PID"
$containerId = $null
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agy-bridge-context-$PID"
$canaryId = [Guid]::NewGuid().ToString('N')
$canaries = @(
  "dockerignore-canary-$canaryId.env",
  "dockerignore-canary-$canaryId.jsonl",
  ".local/dockerignore-canary-$canaryId-secret",
  "state/dockerignore-canary-$canaryId-secret",
  ".deno/dockerignore-canary-$canaryId-secret",
  ".atl/dockerignore-canary-$canaryId-secret"
)

try {
  foreach ($relative in $canaries) {
    $path = Join-Path (Get-Location) $relative
    $parent = Split-Path -Parent $path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    if (Test-Path $path) { throw "refusing to overwrite existing canary path: $relative" }
    Set-Content -NoNewline -Path $path -Value 'dockerignore-canary-secret'
  }

  docker build -f docker/tests/Dockerfile.context -t $tag . | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'docker context image build failed' }

  $containerId = docker create $tag /unused
  if ($LASTEXITCODE -ne 0 -or -not $containerId) { throw 'docker create failed' }

  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  docker cp "${containerId}:/context/." $tempRoot | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'docker cp failed' }

  foreach ($relative in $canaries) {
    if (Test-Path (Join-Path $tempRoot $relative)) {
      throw "dockerignore leak: $relative was copied into the build context image"
    }
  }
  if (-not (Test-Path (Join-Path $tempRoot 'agy-bridge.ts'))) {
    throw 'control failure: tracked agy-bridge.ts was not copied into context image'
  }

  Write-Host 'PASS: ignored local secret/state canaries are absent from Docker build context'
}
finally {
  if ($containerId) { docker rm -f $containerId 2>$null | Out-Null }
  docker image rm -f $tag 2>$null | Out-Null
  foreach ($relative in $canaries) {
    Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path (Get-Location) $relative)
  }
  foreach ($dir in @('.local', 'state', '.deno', '.atl')) {
    $path = Join-Path (Get-Location) $dir
    if ((Test-Path $path) -and -not (Get-ChildItem -Force $path -ErrorAction SilentlyContinue)) {
      Remove-Item -Force -ErrorAction SilentlyContinue $path
    }
  }
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tempRoot
}
