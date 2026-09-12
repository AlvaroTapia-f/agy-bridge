$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$workspace = Join-Path ([System.IO.Path]::GetTempPath()) ("agy-bridge-workspace-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $workspace | Out-Null
$previous = $env:AGY_WORKSPACE_HOST_PATH

try {
  $env:AGY_WORKSPACE_HOST_PATH = $workspace
  $json = docker compose -f compose.yaml -f compose.workspace.yaml config --format json
  if ($LASTEXITCODE -ne 0) { throw 'workspace Compose config failed to resolve' }
  $config = $json | ConvertFrom-Json
  $bridge = $config.services.'agy-bridge'
  if (-not $bridge) { throw 'agy-bridge service missing' }

  $workspaceMounts = @($bridge.volumes | Where-Object { $_.target -eq '/workspace' })
  if ($workspaceMounts.Count -ne 1) { throw "expected exactly one /workspace mount, got $($workspaceMounts.Count)" }
  $mount = $workspaceMounts[0]
  if ($mount.type -ne 'bind') { throw '/workspace must be a bind mount' }
  if ($mount.read_only -ne $true) { throw '/workspace bind must be read-only' }
  $createHostPath = $mount.bind.PSObject.Properties['create_host_path']
  if ($null -eq $createHostPath -or $createHostPath.Value -ne $false) {
    throw '/workspace bind.create_host_path must be false'
  }

  if ($bridge.environment.AGY_WORKSPACE_ROOT -ne '/workspace') { throw 'AGY_WORKSPACE_ROOT must be /workspace' }
  if ($bridge.environment.AGY_WORKSPACE_MODE -ne 'ro') { throw 'AGY_WORKSPACE_MODE must be ro' }
  if ([string]$bridge.environment.MAX_CONCURRENT -ne '1') { throw 'workspace MAX_CONCURRENT must be 1' }
  if ($bridge.read_only -ne $true) { throw 'workspace root filesystem must be read-only' }

  $tmpfsText = @($bridge.tmpfs) -join "`n"
  if ($tmpfsText -notmatch '(^|\n)/tmp($|\n|:)') { throw 'workspace tmpfs must contain /tmp' }
  if ($tmpfsText -notmatch '/home/agy/\.cache') { throw 'workspace tmpfs must contain /home/agy/.cache' }

  $published = @($bridge.ports)
  if ($published.Count -ne 1) { throw "expected one published port, got $($published.Count)" }
  $port = $published[0]
  if ($port.host_ip -ne '127.0.0.1' -or [int]$port.published -ne 7421 -or [int]$port.target -ne 7421) {
    throw 'workspace deployment must publish only 127.0.0.1:7421 -> 7421'
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

  Write-Host 'PASS: explicit read-only workspace Compose boundary'
}
finally {
  if ($null -eq $previous) { Remove-Item Env:AGY_WORKSPACE_HOST_PATH -ErrorAction SilentlyContinue }
  else { $env:AGY_WORKSPACE_HOST_PATH = $previous }
  Remove-Item -Recurse -Force $workspace -ErrorAction SilentlyContinue
}
