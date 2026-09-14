[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Invoke-NativeCapture {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [switch]$AllowFailure,
    [switch]$Quiet
  )

  $savedErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = @(& $FilePath @ArgumentList 2>&1)
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $savedErrorActionPreference
  }

  $text = ($lines | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if (-not $Quiet -and $text) {
    Write-Host $text
  }
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "$FilePath $($ArgumentList -join ' ') failed with exit code $exitCode`n$text"
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = $text
  }
}

$originalLocation = Get-Location
$tag = "agy-bridge-context-test-$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$containerId = $null
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agy-bridge-context-$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$canaryId = [Guid]::NewGuid().ToString('N')
$createdPaths = @()
$canaries = @(
  "LOCAL-ONLY-BUILD-CONTEXT-CANARY-$canaryId.txt",
  "docker/LOCAL-ONLY-BUILD-CONTEXT-CANARY-$canaryId.txt",
  "plugins/LOCAL-ONLY-BUILD-CONTEXT-CANARY-$canaryId.txt",
  "agents/LOCAL-ONLY-BUILD-CONTEXT-CANARY-$canaryId.txt",
  "agents/raw/LOCAL-ONLY-BUILD-CONTEXT-CANARY-$canaryId.txt",
  "agents/worker-ro/LOCAL-ONLY-BUILD-CONTEXT-CANARY-$canaryId.txt",
  "agents/worker-rw/LOCAL-ONLY-BUILD-CONTEXT-CANARY-$canaryId.txt",
  "agents/agy-bridge-worker-ro-v1/LOCAL-ONLY-BUILD-CONTEXT-CANARY-$canaryId.txt",
  "agents/agy-bridge-worker-rw-v1/LOCAL-ONLY-BUILD-CONTEXT-CANARY-$canaryId.txt",
  "docker/workspace/LOCAL-ONLY-BUILD-CONTEXT-CANARY-$canaryId.txt",
  '.env',
  ".env.dockerignore-canary-$canaryId",
  "dockerignore-canary-$canaryId.env",
  "dockerignore-canary-$canaryId.log",
  "dockerignore-canary-$canaryId.jsonl",
  ".local/dockerignore-canary-$canaryId-secret",
  "state/dockerignore-canary-$canaryId-secret",
  ".deno/dockerignore-canary-$canaryId-secret",
  ".atl/dockerignore-canary-$canaryId-secret",
  "coverage/dockerignore-canary-$canaryId-secret",
  "cov_profile/dockerignore-canary-$canaryId-secret",
  "node_modules/dockerignore-canary-$canaryId-secret",
  ".vscode/dockerignore-canary-$canaryId-secret",
  ".idea/dockerignore-canary-$canaryId-secret"
)

try {
  $repoRoot = (Invoke-NativeCapture -FilePath 'git' -ArgumentList @(
    'rev-parse', '--show-toplevel'
  ) -Quiet).Output.Trim()
  if (-not $repoRoot) {
    throw 'not inside the agy-bridge Git checkout'
  }
  Set-Location $repoRoot

  if (-not (Test-Path '.env.example')) {
    throw 'control failure: tracked .env.example is missing from the source checkout'
  }

  foreach ($relative in $canaries) {
    $path = Join-Path $repoRoot $relative
    if (Test-Path $path) {
      if ($relative -eq '.env') {
        continue
      }
      throw "refusing to overwrite existing canary path: $relative"
    }
    $parent = Split-Path -Parent $path
    if ($parent) {
      New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    Set-Content -NoNewline -Path $path -Value 'dockerignore-canary-secret'
    $createdPaths += $path
  }

  Invoke-NativeCapture -FilePath 'docker' -ArgumentList @(
    'build', '-f', 'docker/tests/Dockerfile.context', '-t', $tag, '.'
  ) | Out-Null

  $containerId = (Invoke-NativeCapture -FilePath 'docker' -ArgumentList @(
    'create', $tag, '/unused'
  ) -Quiet).Output.Trim()
  if (-not $containerId) {
    throw 'docker create returned no container id'
  }

  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
  Invoke-NativeCapture -FilePath 'docker' -ArgumentList @(
    'cp', "${containerId}:/context/.", $tempRoot
  ) | Out-Null

  foreach ($relative in @('.git') + $canaries) {
    if (Test-Path (Join-Path $tempRoot $relative)) {
      throw "dockerignore leak: $relative was copied into the build context image"
    }
  }
  foreach ($control in @(
    'agy-bridge.ts',
    '.env.example',
    'agents/agy-bridge-worker-ro-v1/agent.md',
    'agents/agy-bridge-worker-rw-v1/agent.md',
    'compose.workspace.yaml',
    'compose.workspace-rw.yaml',
    'docker/workspace-policy.sh',
    'docker/workspace/verified-agy-versions.txt',
    'docker/workspace/verified-rw-agy-versions.txt'
  )) {
    if (-not (Test-Path (Join-Path $tempRoot $control))) {
      throw "control failure: $control was not copied into the build context image"
    }
  }

  Write-Host 'PASS: Docker build context excludes arbitrary local-only files, Git metadata, and local secret/state canaries'
}
finally {
  Set-Location $originalLocation
  if ($containerId) {
    Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('rm', '-f', $containerId) -AllowFailure -Quiet | Out-Null
  }
  Invoke-NativeCapture -FilePath 'docker' -ArgumentList @('image', 'rm', '-f', $tag) -AllowFailure -Quiet | Out-Null
  foreach ($path in $createdPaths) {
    Remove-Item -Force -ErrorAction SilentlyContinue $path
  }
  foreach ($relative in @(
    '.local', 'state', '.deno', '.atl', 'coverage', 'cov_profile',
    'node_modules', '.vscode', '.idea'
  )) {
    $path = Join-Path $repoRoot $relative
    if ((Test-Path $path) -and -not (Get-ChildItem -Force $path -ErrorAction SilentlyContinue)) {
      Remove-Item -Force -ErrorAction SilentlyContinue $path
    }
  }
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tempRoot
}
