$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-StartupRejected {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Workspace,
    [Parameter(Mandatory = $true)][string]$Root,
    [Parameter(Mandatory = $true)][string]$Mode,
    [Parameter(Mandatory = $true)][string]$MaxConcurrent,
    [ValidateSet('none', 'ro', 'rw')][string]$WorkspaceMount = 'rw',
    [bool]$ReadOnlyRoot = $true,
    [string]$AgyBin = '/home/agy/.local/bin/agy',
    [Parameter(Mandatory = $true)][string]$Expected
  )

  $dockerArgs = @('run', '--rm')
  if ($ReadOnlyRoot) { $dockerArgs += '--read-only' }
  $dockerArgs += @(
    '--tmpfs', '/tmp:rw',
    '--tmpfs', '/home/agy/.local/share/agy-secrets:rw,uid=10001,gid=10001,mode=0700',
    '--tmpfs', '/home/agy/.local/state/agy-bridge:rw,uid=10001,gid=10001,mode=0700'
  )
  if ($WorkspaceMount -ne 'none') {
    $workspaceDockerPath = $Workspace -replace '\\', '/'
    $mount = "type=bind,src=$workspaceDockerPath,dst=/workspace"
    if ($WorkspaceMount -eq 'ro') { $mount += ',readonly' }
    $dockerArgs += @('--mount', $mount)
  }
  $dockerArgs += @(
    '-e', "AGY_WORKSPACE_ROOT=$Root",
    '-e', "AGY_WORKSPACE_MODE=$Mode",
    '-e', "MAX_CONCURRENT=$MaxConcurrent",
    '-e', "AGY_BIN=$AgyBin",
    'agy-bridge:local',
    'bash', '/app/docker/start-bridge.sh'
  )

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = (& docker @dockerArgs 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($exitCode -eq 0) { throw "$Name unexpectedly started successfully" }
  if ($output -notmatch [regex]::Escape($Expected)) {
    throw "$Name failed for the wrong reason. Expected '$Expected'. Output:`n$output"
  }
}

$workspace = Join-Path ([System.IO.Path]::GetTempPath()) ("agy-bridge-workspace-rw-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workspace | Out-Null
$previous = $env:AGY_WORKSPACE_HOST_PATH

try {
  $env:AGY_WORKSPACE_HOST_PATH = $workspace
  $json = docker compose -f compose.yaml -f compose.workspace-rw.yaml config --format json
  if ($LASTEXITCODE -ne 0) { throw 'RW workspace Compose config failed to resolve' }
  $config = $json | ConvertFrom-Json
  $bridge = $config.services.'agy-bridge'
  if (-not $bridge) { throw 'agy-bridge service missing' }

  $workspaceMounts = @($bridge.volumes | Where-Object { $_.target -eq '/workspace' })
  if ($workspaceMounts.Count -ne 1) { throw "expected exactly one /workspace mount, got $($workspaceMounts.Count)" }
  $mount = $workspaceMounts[0]
  if ($mount.type -ne 'bind') { throw '/workspace must be a bind mount' }

  $workspaceComposeSource = Get-Content -LiteralPath 'compose.workspace-rw.yaml' -Raw
  if ($workspaceComposeSource -notmatch '(?m)^\s*read_only:\s*false\s*$') {
    throw 'compose.workspace-rw.yaml must declare /workspace read_only: false'
  }
  $readOnly = $mount.PSObject.Properties['read_only']
  if ($null -ne $readOnly -and $readOnly.Value -eq $true) {
    throw '/workspace resolved bind must not be read-only'
  }
  if ($workspaceComposeSource -notmatch '(?m)^\s*create_host_path:\s*false\s*$') {
    throw 'compose.workspace-rw.yaml must declare bind.create_host_path: false'
  }
  $createHostPath = $mount.bind.PSObject.Properties['create_host_path']
  if ($null -ne $createHostPath -and $createHostPath.Value -ne $false) {
    throw '/workspace resolved bind.create_host_path must not be true'
  }

  if ($bridge.environment.AGY_WORKSPACE_ROOT -ne '/workspace') { throw 'AGY_WORKSPACE_ROOT must be /workspace' }
  if ($bridge.environment.AGY_WORKSPACE_MODE -ne 'rw') { throw 'AGY_WORKSPACE_MODE must be rw' }
  if ([string]$bridge.environment.MAX_CONCURRENT -ne '1') { throw 'workspace MAX_CONCURRENT must be 1' }
  if ($bridge.read_only -ne $true) { throw 'RW workspace root filesystem must be read-only' }

  $tmpfsText = @($bridge.tmpfs) -join "`n"
  if ($tmpfsText -notmatch '(^|\n)/tmp($|\n|:)') { throw 'RW workspace tmpfs must contain /tmp' }
  if ($tmpfsText -notmatch '/home/agy/\.cache') { throw 'RW workspace tmpfs must contain /home/agy/.cache' }

  $published = @($bridge.ports)
  if ($published.Count -ne 1) { throw "expected one published port, got $($published.Count)" }
  $port = $published[0]
  if ($port.host_ip -ne '127.0.0.1' -or [int]$port.published -ne 7421 -or [int]$port.target -ne 7421) {
    throw 'RW workspace deployment must publish only 127.0.0.1:7421 -> 7421'
  }

  $bridgeText = $bridge | ConvertTo-Json -Depth 20
  if ($bridgeText -match '/var/run/docker\.sock') { throw 'Docker socket must not be mounted' }
  $privileged = $bridge.PSObject.Properties['privileged']
  if ($null -ne $privileged -and $privileged.Value -eq $true) { throw 'privileged mode must be disabled' }
  $networkMode = $bridge.PSObject.Properties['network_mode']
  if ($null -ne $networkMode -and [string]$networkMode.Value -eq 'host') { throw 'host network must not be used' }

  foreach ($name in @('agy-auth', 'print-token', 'init-secrets', 'test')) {
    $serviceProperty = $config.services.PSObject.Properties[$name]
    if ($null -eq $serviceProperty) { continue }
    $text = $serviceProperty.Value.volumes | ConvertTo-Json -Depth 10
    if ($text -match '"target"\s*:\s*"/workspace"') {
      throw "$name must not receive the /workspace mount"
    }
  }

  foreach ($volumeName in @('agy-config', 'agy-keyring', 'agy-secrets', 'bridge-state')) {
    if ($null -eq $config.volumes.PSObject.Properties[$volumeName]) {
      throw "required named volume missing: $volumeName"
    }
  }

  Assert-StartupRejected -Name 'rw-missing-workspace-mount' -Workspace $workspace -Root '/workspace' -Mode 'rw' -MaxConcurrent '1' -WorkspaceMount 'none' -Expected 'workspace mode requires /workspace to be a distinct mount'
  Assert-StartupRejected -Name 'rw-mounted-ro' -Workspace $workspace -Root '/workspace' -Mode 'rw' -MaxConcurrent '1' -WorkspaceMount 'ro' -Expected 'read-write workspace mount must be writable'
  Assert-StartupRejected -Name 'writable-rootfs' -Workspace $workspace -Root '/workspace' -Mode 'rw' -MaxConcurrent '1' -WorkspaceMount 'rw' -ReadOnlyRoot $false -Expected 'container root filesystem must be read-only'
  Assert-StartupRejected -Name 'wrong-root' -Workspace $workspace -Root '/not-workspace' -Mode 'rw' -MaxConcurrent '1' -WorkspaceMount 'rw' -Expected 'workspace mode requires AGY_WORKSPACE_ROOT=/workspace'
  Assert-StartupRejected -Name 'wrong-mode' -Workspace $workspace -Root '/workspace' -Mode 'invalid' -MaxConcurrent '1' -WorkspaceMount 'rw' -Expected 'workspace mode requires AGY_WORKSPACE_MODE=ro or rw'
  Assert-StartupRejected -Name 'wrong-concurrency' -Workspace $workspace -Root '/workspace' -Mode 'rw' -MaxConcurrent '2' -WorkspaceMount 'rw' -Expected 'workspace mode requires MAX_CONCURRENT=1'

  $collision = Join-Path $workspace '.agents\agents\agy-bridge-worker-rw-v1\agent.md'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $collision) | Out-Null
  Set-Content -LiteralPath $collision -Value 'collision' -NoNewline
  Assert-StartupRejected -Name 'rw-agent-collision' -Workspace $workspace -Root '/workspace' -Mode 'rw' -MaxConcurrent '1' -WorkspaceMount 'rw' -Expected 'workspace contains reserved agent collision'
  Remove-Item -Recurse -Force (Join-Path $workspace '.agents')

  Assert-StartupRejected -Name 'rw-version-not-verified' -Workspace $workspace -Root '/workspace' -Mode 'rw' -MaxConcurrent '1' -WorkspaceMount 'rw' -Expected 'agy 1.2.2 is not verified for explicit read-write host workspace mode'
  Assert-StartupRejected -Name 'ro-mounted-rw' -Workspace $workspace -Root '/workspace' -Mode 'ro' -MaxConcurrent '1' -WorkspaceMount 'rw' -Expected 'read-only workspace mount must be read-only'
  Assert-StartupRejected -Name 'ro-version-allowlist' -Workspace $workspace -Root '/workspace' -Mode 'ro' -MaxConcurrent '1' -WorkspaceMount 'ro' -AgyBin 'deno' -Expected 'agy 2.9.6 is not verified for explicit read-only host workspace mode'

  Write-Host 'PASS: explicit read-write workspace Compose boundary'
}
finally {
  if ($null -eq $previous) { Remove-Item Env:AGY_WORKSPACE_HOST_PATH -ErrorAction SilentlyContinue }
  else { $env:AGY_WORKSPACE_HOST_PATH = $previous }
  Remove-Item -Recurse -Force $workspace -ErrorAction SilentlyContinue
}
