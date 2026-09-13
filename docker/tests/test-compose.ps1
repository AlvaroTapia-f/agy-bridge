$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$defaultServices = @(docker compose config --services)
if ($defaultServices -contains 'agy-auth') { throw 'agy-auth must not be part of default Compose startup' }
if ($defaultServices -contains 'print-token') { throw 'print-token must not be part of default Compose startup' }
if ($defaultServices -contains 'init-secrets') { throw 'init-secrets must not be part of default Compose startup' }
if ($defaultServices -contains 'test') { throw 'test must not be part of default Compose startup' }
if ($defaultServices -notcontains 'agy-bridge') { throw 'agy-bridge must be enabled by default' }

$config = docker compose config --format json | ConvertFrom-Json
$bridge = $config.services.'agy-bridge'
if (-not $bridge) { throw 'agy-bridge service missing' }

$published = @($bridge.ports)
if ($published.Count -ne 1) { throw "expected one published port, got $($published.Count)" }
$port = $published[0]
if ($port.host_ip -ne '127.0.0.1') { throw "host_ip must be 127.0.0.1, got $($port.host_ip)" }
if ([int]$port.published -ne 7421 -or [int]$port.target -ne 7421) { throw 'expected 127.0.0.1:7421 -> 7421' }

# Docker Compose may omit optional properties that are at their safe defaults.
# Under StrictMode, direct access to a missing property throws, so inspect the
# PSObject property bag first. Missing `privileged` means false; missing
# `network_mode` means Compose's normal (non-host) networking.
$privilegedProperty = $bridge.PSObject.Properties['privileged']
if ($null -ne $privilegedProperty -and $privilegedProperty.Value -eq $true) {
  throw 'privileged mode must be disabled'
}

$networkModeProperty = $bridge.PSObject.Properties['network_mode']
if ($null -ne $networkModeProperty -and [string]$networkModeProperty.Value -eq 'host') {
  throw 'host network must not be used'
}

$mountText = ($bridge.volumes | ConvertTo-Json -Depth 8)
if ($mountText -match '/var/run/docker\.sock') { throw 'Docker socket must not be mounted' }

Write-Host 'PASS: default Compose lifecycle and loopback-only security boundary'
