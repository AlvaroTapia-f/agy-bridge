[CmdletBinding()]
param(
  [string]$ExpectedHead = '',
  [string]$Model = '',
  [string]$BaseRef = '',
  [switch]$SkipLive,
  [switch]$SkipDockerRestart,
  [int]$DockerRestartTimeoutSec = 300,
  [int]$ServiceStartTimeoutSec = 120,
  [int]$RequestTimeoutSec = 180
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Net.Http

$script:Results = @()
$script:HadFailure = $false
$script:Incomplete = $false
$script:FatalMessage = $null
$script:ApiBase = 'http://127.0.0.1:7421'
$script:SelectedModel = $null
$script:BridgeToken = $null

function Add-Result {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][ValidateSet('PASS', 'FAIL', 'SKIP')][string]$Status,
    [string]$Detail = ''
  )
  $script:Results += [pscustomobject]@{
    Gate = $Name
    Status = $Status
    Detail = $Detail
  }
}

function Invoke-Gate {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )
  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  try {
    & $Action
    Add-Result -Name $Name -Status PASS
    Write-Host "PASS: $Name" -ForegroundColor Green
  }
  catch {
    $script:HadFailure = $true
    $message = $_.Exception.Message
    Add-Result -Name $Name -Status FAIL -Detail $message
    Write-Host "FAIL: $Name - $message" -ForegroundColor Red
    throw
  }
}

function Add-Skip {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Reason
  )
  $script:Incomplete = $true
  Add-Result -Name $Name -Status SKIP -Detail $Reason
  Write-Host "SKIP: $Name - $Reason" -ForegroundColor Yellow
}

function Invoke-NativeCapture {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @(),
    [switch]$AllowFailure,
    [switch]$Quiet
  )

  # Windows PowerShell 5.1 can promote redirected native stderr records to
  # terminating errors when ErrorActionPreference is Stop. Docker/BuildKit
  # writes normal progress to stderr, so temporarily relax only the native
  # invocation and decide success/failure from LASTEXITCODE below.
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

function Invoke-DockerCapture {
  param(
    [string[]]$ArgumentList = @(),
    [switch]$AllowFailure,
    [switch]$Quiet
  )
  return Invoke-NativeCapture -FilePath 'docker' -ArgumentList $ArgumentList -AllowFailure:$AllowFailure -Quiet:$Quiet
}

function Invoke-Http {
  param(
    [Parameter(Mandatory = $true)][ValidateSet('GET', 'POST')][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [hashtable]$Headers = @{},
    [string]$Body = ''
  )

  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds($RequestTimeoutSec)
  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::new($Method),
    $Uri
  )
  try {
    foreach ($name in $Headers.Keys) {
      $value = [string]$Headers[$name]
      if ($name -eq 'Host') {
        $request.Headers.Host = $value
      }
      elseif (-not $request.Headers.TryAddWithoutValidation($name, $value)) {
        throw "unable to set HTTP header: $name"
      }
    }
    if ($Method -eq 'POST') {
      $request.Content = [System.Net.Http.StringContent]::new(
        $Body,
        [System.Text.Encoding]::UTF8,
        'application/json'
      )
    }

    $response = $client.SendAsync($request).GetAwaiter().GetResult()
    try {
      $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      return [pscustomobject]@{
        StatusCode = [int]$response.StatusCode
        Content = $content
      }
    }
    finally {
      $response.Dispose()
    }
  }
  finally {
    $request.Dispose()
    $client.Dispose()
  }
}

function Invoke-DockerInfoProbe {
  param([int]$TimeoutMs = 3000)

  # docker info can block on the Windows Docker named pipe while Desktop is
  # restarting. Run the probe as its own process with a hard per-call timeout
  # so one wedged CLI invocation cannot freeze the entire verifier.
  $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = 'docker'
  $startInfo.Arguments = 'info --format "{{.ServerVersion}}"'
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $startInfo.CreateNoWindow = $true

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) {
      return [pscustomobject]@{
        Available = $false
        TimedOut = $false
        ExitCode = $null
        Detail = 'docker info probe did not start'
      }
    }

    if (-not $process.WaitForExit($TimeoutMs)) {
      try { $process.Kill() } catch { }
      try { [void]$process.WaitForExit(1000) } catch { }
      return [pscustomobject]@{
        Available = $false
        TimedOut = $true
        ExitCode = $null
        Detail = "docker info probe timed out after ${TimeoutMs}ms"
      }
    }

    $stdout = $process.StandardOutput.ReadToEnd().Trim()
    $stderr = $process.StandardError.ReadToEnd().Trim()
    $exitCode = $process.ExitCode
    $detail = if ($exitCode -eq 0) {
      $stdout
    }
    elseif ($stderr) {
      $stderr
    }
    else {
      "docker info exited with code $exitCode"
    }

    return [pscustomobject]@{
      Available = ($exitCode -eq 0)
      TimedOut = $false
      ExitCode = $exitCode
      Detail = $detail
    }
  }
  catch {
    return [pscustomobject]@{
      Available = $false
      TimedOut = $false
      ExitCode = $null
      Detail = $_.Exception.Message
    }
  }
  finally {
    $process.Dispose()
  }
}

function Wait-Docker {
  Write-Host '[Docker restart] waiting for daemon recovery...' -ForegroundColor DarkYellow
  $deadline = [DateTime]::UtcNow.AddSeconds($DockerRestartTimeoutSec)
  do {
    # docker info, bounded by Invoke-DockerInfoProbe
    $probe = Invoke-DockerInfoProbe -TimeoutMs 3000
    if ($probe.Available) {
      Write-Host '[Docker restart] daemon is UP.' -ForegroundColor DarkYellow
      return
    }
    if ($probe.TimedOut) {
      Write-Host '[Docker restart] probe timed out; daemon still unavailable...' -ForegroundColor DarkYellow
    }
    else {
      Write-Host '[Docker restart] daemon still unavailable...' -ForegroundColor DarkYellow
    }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Docker daemon did not become available after the restart checkpoint'
}

function Wait-DockerUnavailable {
  Write-Host '[Docker restart] waiting for daemon outage...' -ForegroundColor DarkYellow
  $deadline = [DateTime]::UtcNow.AddSeconds($DockerRestartTimeoutSec)
  $downStreak = 0
  do {
    $probe = Invoke-DockerInfoProbe -TimeoutMs 3000
    if (-not $probe.Available) {
      $downStreak++
      $reason = if ($probe.TimedOut) { 'probe timed out' } else { 'docker info failed' }
      Write-Host "[Docker restart] $reason -> DOWN candidate ($downStreak/2)" -ForegroundColor DarkYellow
      if ($downStreak -ge 2) {
        Write-Host '[Docker restart] daemon outage confirmed.' -ForegroundColor DarkYellow
        return
      }
    }
    else {
      if ($downStreak -gt 0) {
        Write-Host '[Docker restart] daemon responded again; resetting outage confirmation.' -ForegroundColor DarkYellow
      }
      $downStreak = 0
      Write-Host '[Docker restart] daemon still UP; restart not observed yet...' -ForegroundColor DarkYellow
    }
    Start-Sleep -Seconds 1
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'Docker daemon did not become unavailable during the restart checkpoint'
}

function Wait-BridgeHealth {
  $deadline = [DateTime]::UtcNow.AddSeconds($ServiceStartTimeoutSec)
  $lastError = 'no response yet'
  do {
    try {
      $res = Invoke-Http -Method GET -Uri "$($script:ApiBase)/healthz"
      if ($res.StatusCode -eq 200) {
        return
      }
      $lastError = "HTTP $($res.StatusCode)"
    }
    catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "bridge did not become healthy: $lastError"
}

function Get-BridgeToken {
  $result = Invoke-DockerCapture -ArgumentList @('compose', '--profile', 'tools', 'run', '--rm', 'print-token') -Quiet
  $match = [regex]::Match($result.Output, 'AGY_TOKEN=([0-9a-f]{48})')
  if (-not $match.Success) {
    throw 'could not obtain the local bridge Bearer token from print-token'
  }
  return $match.Groups[1].Value
}

function Assert-OAuthPreflight {
  $command = '/app/docker/keyring-session.sh "$AGY_BIN" models >/tmp/verify-models.tsv && test -s /tmp/verify-models.tsv'
  $result = Invoke-DockerCapture -ArgumentList @(
    'compose', 'run', '--rm', '--no-deps', '--entrypoint', 'bash',
    'agy-bridge', '-lc', $command
  ) -AllowFailure -Quiet
  if ($result.ExitCode -ne 0) {
    throw "Antigravity OAuth is not reusable from the persisted volumes. Run 'docker compose run --rm agy-auth' once, then rerun this verifier."
  }
}

function Get-AuthenticatedModels {
  param([Parameter(Mandatory = $true)][string]$Token)
  $res = Invoke-Http -Method GET -Uri "$($script:ApiBase)/v1/models" -Headers @{
    Authorization = "Bearer $Token"
  }
  if ($res.StatusCode -ne 200) {
    throw "authenticated /v1/models returned HTTP $($res.StatusCode)"
  }
  $json = $res.Content | ConvertFrom-Json
  $ids = @($json.data | ForEach-Object { [string]$_.id } | Where-Object { $_ })
  if ($ids.Count -eq 0) {
    throw 'authenticated /v1/models returned an empty model list'
  }
  return $ids
}

function Invoke-CompletionSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$WireModel,
    [Parameter(Mandatory = $true)][string]$Token,
    [Parameter(Mandatory = $true)][string]$Prompt
  )
  $body = @{
    model = $WireModel
    messages = @(@{ role = 'user'; content = $Prompt })
  } | ConvertTo-Json -Depth 8 -Compress
  $res = Invoke-Http -Method POST -Uri "$($script:ApiBase)/v1/chat/completions" -Headers @{
    Authorization = "Bearer $Token"
  } -Body $body
  if ($res.StatusCode -ne 200) {
    throw "$WireModel completion returned HTTP $($res.StatusCode): $($res.Content)"
  }
  $json = $res.Content | ConvertFrom-Json
  $content = [string]$json.choices[0].message.content
  if ([string]::IsNullOrWhiteSpace($content)) {
    throw "$WireModel completion returned no assistant content"
  }
}

function Invoke-StreamingSmoke {
  param(
    [Parameter(Mandatory = $true)][string]$WireModel,
    [Parameter(Mandatory = $true)][string]$Token
  )
  $body = @{
    model = $WireModel
    stream = $true
    messages = @(@{ role = 'user'; content = 'Reply briefly with STREAM_VERIFY_OK.' })
  } | ConvertTo-Json -Depth 8 -Compress
  $res = Invoke-Http -Method POST -Uri "$($script:ApiBase)/v1/chat/completions" -Headers @{
    Authorization = "Bearer $Token"
  } -Body $body
  if ($res.StatusCode -ne 200) {
    throw "streaming completion returned HTTP $($res.StatusCode): $($res.Content)"
  }
  if (-not $res.Content.Contains('data: [DONE]')) {
    throw 'streaming completion did not terminate with data: [DONE]'
  }
  if ($res.Content -match '"error"\s*:') {
    throw 'streaming completion contained an error event'
  }
}

function Set-StateMarker {
  param([Parameter(Mandatory = $true)][string]$Marker)
  $command = "printf '%s' '$Marker' > /home/agy/.local/state/agy-bridge/verify-persistence-marker"
  Invoke-DockerCapture -ArgumentList @('compose', 'exec', '-T', 'agy-bridge', 'bash', '-lc', $command) -Quiet | Out-Null
}

function Assert-StateMarker {
  param([Parameter(Mandatory = $true)][string]$Marker)
  $result = Invoke-DockerCapture -ArgumentList @(
    'compose', 'exec', '-T', 'agy-bridge', 'cat',
    '/home/agy/.local/state/agy-bridge/verify-persistence-marker'
  ) -Quiet
  if ($result.Output.Trim() -ne $Marker) {
    throw 'bridge-state persistence marker is missing or changed'
  }
}

function Assert-ApiAfterPersistenceTransition {
  param(
    [Parameter(Mandatory = $true)][string]$ExpectedToken,
    [Parameter(Mandatory = $true)][string]$Marker
  )
  Wait-BridgeHealth
  $currentToken = Get-BridgeToken
  if ($currentToken -ne $ExpectedToken) {
    throw 'local Bearer token changed across a persistence transition'
  }
  $models = Get-AuthenticatedModels -Token $ExpectedToken
  if ($models.Count -eq 0) {
    throw 'OAuth reuse verification returned no models'
  }
  Assert-StateMarker -Marker $Marker
}

function Test-DestructiveReset {
  $suffix = [Guid]::NewGuid().ToString('N').Substring(0, 12)
  $project = "agy-bridge-reset-$suffix"
  $marker = "reset-$suffix"
  $token1 = $null
  try {
    Invoke-DockerCapture -ArgumentList @('compose', '-p', $project, '--profile', 'tools', 'run', '--rm', 'init-secrets') -Quiet | Out-Null
    $first = Invoke-DockerCapture -ArgumentList @('compose', '-p', $project, '--profile', 'tools', 'run', '--rm', 'print-token') -Quiet
    $m1 = [regex]::Match($first.Output, 'AGY_TOKEN=([0-9a-f]{48})')
    if (-not $m1.Success) { throw 'disposable reset project did not generate a bridge token' }
    $token1 = $m1.Groups[1].Value

    $writeMarkers = "printf '%s' '$marker' > /home/agy/.gemini/.verify-marker; printf '%s' '$marker' > /home/agy/.local/share/keyrings/.verify-marker"
    Invoke-DockerCapture -ArgumentList @(
      'compose', '-p', $project, '--profile', 'tools', 'run', '--rm',
      '--entrypoint', 'bash', 'agy-auth', '-lc', $writeMarkers
    ) -Quiet | Out-Null

    # docker compose down -v (disposable project only)
    Invoke-DockerCapture -ArgumentList @('compose', '-p', $project, '--profile', 'tools', 'down', '-v', '--remove-orphans') -Quiet | Out-Null

    Invoke-DockerCapture -ArgumentList @('compose', '-p', $project, '--profile', 'tools', 'run', '--rm', 'init-secrets') -Quiet | Out-Null
    $second = Invoke-DockerCapture -ArgumentList @('compose', '-p', $project, '--profile', 'tools', 'run', '--rm', 'print-token') -Quiet
    $m2 = [regex]::Match($second.Output, 'AGY_TOKEN=([0-9a-f]{48})')
    if (-not $m2.Success) { throw 'disposable reset project did not regenerate a bridge token' }
    if ($m2.Groups[1].Value -eq $token1) {
      throw 'down -v did not reset the disposable agy-secrets volume'
    }

    $assertMarkersGone = 'test ! -e /home/agy/.gemini/.verify-marker && test ! -e /home/agy/.local/share/keyrings/.verify-marker'
    Invoke-DockerCapture -ArgumentList @(
      'compose', '-p', $project, '--profile', 'tools', 'run', '--rm',
      '--entrypoint', 'bash', 'agy-auth', '-lc', $assertMarkersGone
    ) -Quiet | Out-Null
  }
  finally {
    Invoke-DockerCapture -ArgumentList @('compose', '-p', $project, '--profile', 'tools', 'down', '-v', '--remove-orphans') -AllowFailure -Quiet | Out-Null
  }
}

$originalLocation = Get-Location
$repoRoot = (Invoke-NativeCapture -FilePath 'git' -ArgumentList @(
  'rev-parse', '--show-toplevel'
) -Quiet).Output.Trim()
if (-not $repoRoot) {
  throw 'not inside the agy-bridge Git checkout'
}
$repoMountRoot = $repoRoot -replace '\\', '/'
$dockerTestsMount = "${repoMountRoot}/docker/tests:/mnt/docker-tests:ro"
$dockerDocsMount = "${repoMountRoot}/docs/docker-compose.md:/app/docs/docker-compose.md:ro"
$sourceMount = "${repoMountRoot}:/workspace:ro"
$stageDockerTests = [string]::Join("`n", @(
  'set -euo pipefail',
  'test ! -e /app/docker/tests',
  'cp -R /mnt/docker-tests /tmp/docker-tests',
  "find /tmp/docker-tests -type f -name '*.sh' -exec sed -i 's/\r$//' {} +",
  'ln -s /tmp/docker-tests /app/docker/tests',
  'exec bash /app/docker/tests/run.sh'
))
try {
  Set-Location $repoRoot
  Invoke-Gate -Name 'Repository and final-head identity' -Action {
    & (Join-Path $PSScriptRoot 'assert-pr3-identity.ps1') -BaseRef $BaseRef -ExpectedHead $ExpectedHead
  }

  Invoke-Gate -Name 'Docker and Compose availability' -Action {
    Invoke-DockerCapture -ArgumentList @('version') -Quiet | Out-Null
    Invoke-DockerCapture -ArgumentList @('compose', 'version') -Quiet | Out-Null
  }

  Invoke-Gate -Name 'Docker build-context boundary' -Action {
    & (Join-Path $PSScriptRoot 'test-build-context.ps1')
  }

  Invoke-Gate -Name 'Compose config and loopback boundary' -Action {
    # docker compose config
    Invoke-DockerCapture -ArgumentList @('compose', 'config') -Quiet | Out-Null
    & (Join-Path $PSScriptRoot 'test-compose.ps1')
  }

  Invoke-Gate -Name 'Deterministic Docker suite' -Action {
    # docker compose --profile test build test
    Invoke-DockerCapture -ArgumentList @('compose', '--profile', 'test', 'build', 'test') | Out-Null
    # docker compose --profile test run --rm -v <tests> -v <docs> test
    Invoke-DockerCapture -ArgumentList @(
      'compose', '--profile', 'test', 'run', '--rm',
      '-v', $dockerTestsMount,
      '-v', $dockerDocsMount,
      'test',
      'bash', '-lc', $stageDockerTests
    ) | Out-Null
  }

  Invoke-Gate -Name 'Deno lint inside Docker' -Action {
    # docker compose --profile test run --rm -v <checkout> -w /workspace test deno lint
    Invoke-DockerCapture -ArgumentList @(
      'compose', '--profile', 'test', 'run', '--rm',
      '-v', $sourceMount, '-w', '/workspace',
      'test', 'deno', 'lint'
    ) | Out-Null
  }

  Invoke-Gate -Name 'Full Deno test suite inside Docker' -Action {
    # docker compose --profile test run --rm -v <checkout> -w /workspace test deno task test
    Invoke-DockerCapture -ArgumentList @(
      'compose', '--profile', 'test', 'run', '--rm',
      '-v', $sourceMount, '-w', '/workspace',
      'test', 'deno', 'task', 'test'
    ) | Out-Null
  }

  Invoke-Gate -Name 'Disposable down -v reset semantics' -Action {
    Test-DestructiveReset
  }

  if ($SkipLive) {
    Add-Skip -Name 'Live official-agy acceptance and persistence' -Reason '-SkipLive was specified; merge evidence is incomplete'
  }
  else {
    Invoke-Gate -Name 'Persisted OAuth preflight' -Action {
      $script:BridgeToken = Get-BridgeToken
      Assert-OAuthPreflight
    }

    Invoke-Gate -Name 'Production bridge startup and runtime identity' -Action {
      Invoke-DockerCapture -ArgumentList @('compose', 'up', '-d', 'agy-bridge') | Out-Null
      Wait-BridgeHealth
      $uid = (Invoke-DockerCapture -ArgumentList @('compose', 'exec', '-T', 'agy-bridge', 'id', '-u') -Quiet).Output.Trim()
      $gid = (Invoke-DockerCapture -ArgumentList @('compose', 'exec', '-T', 'agy-bridge', 'id', '-g') -Quiet).Output.Trim()
      if ($uid -ne '10001' -or $gid -ne '10001') {
        throw "runtime identity must be UID/GID 10001, got $uid/$gid"
      }
    }

    Invoke-Gate -Name 'HTTP auth and hostile Host guards' -Action {
      $unauth = Invoke-Http -Method GET -Uri "$($script:ApiBase)/v1/models"
      if ($unauth.StatusCode -ne 401) {
        throw "unauthenticated /v1/models must return 401, got $($unauth.StatusCode)"
      }

      $hostile = Invoke-Http -Method GET -Uri "$($script:ApiBase)/v1/models" -Headers @{
        Authorization = "Bearer $($script:BridgeToken)"
        Host = 'evil.example'
      }
      if ($hostile.StatusCode -ne 403) {
        throw "hostile Host must return 403, got $($hostile.StatusCode)"
      }
    }

    Invoke-Gate -Name 'Authenticated models and model selection' -Action {
      $ids = Get-AuthenticatedModels -Token $script:BridgeToken
      if ($Model) {
        if ($ids -notcontains $Model) {
          throw "requested model '$Model' is not present in /v1/models: $($ids -join ', ')"
        }
        $script:SelectedModel = $Model
      }
      else {
        $flash = @($ids | Where-Object { $_ -match 'flash' })
        $script:SelectedModel = if ($flash.Count -gt 0) { $flash[0] } else { $ids[0] }
      }
      Write-Host "Live verification model: $($script:SelectedModel)"
    }

    Invoke-Gate -Name 'Official agy non-stream completion' -Action {
      Invoke-CompletionSmoke -WireModel $script:SelectedModel -Token $script:BridgeToken -Prompt 'Reply briefly with NON_STREAM_VERIFY_OK.'
    }

    Invoke-Gate -Name 'Official agy streaming completion' -Action {
      Invoke-StreamingSmoke -WireModel $script:SelectedModel -Token $script:BridgeToken
    }

    Invoke-Gate -Name 'auto-ro non-filesystem smoke' -Action {
      Invoke-CompletionSmoke -WireModel "auto-ro-$($script:SelectedModel)" -Token $script:BridgeToken -Prompt 'Reply briefly with AUTO_RO_VERIFY_OK. Do not use tools.'
    }

    Invoke-Gate -Name 'auto-rw non-destructive smoke' -Action {
      Invoke-CompletionSmoke -WireModel "auto-rw-$($script:SelectedModel)" -Token $script:BridgeToken -Prompt 'Reply briefly with AUTO_RW_VERIFY_OK. Do not modify files and do not run commands.'
    }

    $stateMarker = [Guid]::NewGuid().ToString('N')
    Invoke-Gate -Name 'Create bridge-state persistence marker' -Action {
      Set-StateMarker -Marker $stateMarker
      Assert-StateMarker -Marker $stateMarker
    }

    Invoke-Gate -Name 'OAuth/state persistence across container restart' -Action {
      # docker compose restart agy-bridge
      Invoke-DockerCapture -ArgumentList @('compose', 'restart', 'agy-bridge') | Out-Null
      Assert-ApiAfterPersistenceTransition -ExpectedToken $script:BridgeToken -Marker $stateMarker
    }

    Invoke-Gate -Name 'OAuth/state persistence across compose down/up' -Action {
      # docker compose down
      Invoke-DockerCapture -ArgumentList @('compose', 'down') | Out-Null
      Invoke-DockerCapture -ArgumentList @('compose', 'up', '-d', 'agy-bridge') | Out-Null
      Assert-ApiAfterPersistenceTransition -ExpectedToken $script:BridgeToken -Marker $stateMarker
    }

    Invoke-Gate -Name 'OAuth/state persistence across force recreate' -Action {
      # docker compose up -d --force-recreate agy-bridge
      Invoke-DockerCapture -ArgumentList @('compose', 'up', '-d', '--force-recreate', 'agy-bridge') | Out-Null
      Assert-ApiAfterPersistenceTransition -ExpectedToken $script:BridgeToken -Marker $stateMarker
    }

    Invoke-Gate -Name 'OAuth/state persistence across image rebuild' -Action {
      # docker compose build agy-bridge
      Invoke-DockerCapture -ArgumentList @('compose', 'build', 'agy-bridge') | Out-Null
      Invoke-DockerCapture -ArgumentList @('compose', 'up', '-d', '--force-recreate', 'agy-bridge') | Out-Null
      Assert-ApiAfterPersistenceTransition -ExpectedToken $script:BridgeToken -Marker $stateMarker
    }

    if ($SkipDockerRestart) {
      Add-Skip -Name 'OAuth/state persistence across Docker Desktop restart' -Reason '-SkipDockerRestart was specified; merge evidence is incomplete'
    }
    else {
      Invoke-Gate -Name 'OAuth/state persistence across Docker Desktop restart' -Action {
        Write-Host ''
        Write-Host 'ACTION REQUIRED: Prepare to restart Docker Desktop.' -ForegroundColor Yellow
        Write-Host 'After pressing Enter below, immediately restart Docker Desktop. Do not run docker compose down.' -ForegroundColor Yellow
        Write-Host 'The verifier must observe the Docker daemon go offline and then recover.' -ForegroundColor Yellow
        [void](Read-Host 'Press Enter when ready to arm Docker restart detection')
        Wait-DockerUnavailable
        Write-Host 'Docker daemon outage observed; waiting for Docker Desktop to recover...' -ForegroundColor DarkYellow
        Wait-Docker
        Invoke-DockerCapture -ArgumentList @('compose', 'up', '-d', 'agy-bridge') | Out-Null
        Assert-ApiAfterPersistenceTransition -ExpectedToken $script:BridgeToken -Marker $stateMarker
      }
    }
  }
}
catch {
  $script:HadFailure = $true
  $script:FatalMessage = $_.Exception.Message
}
finally {
  Set-Location $originalLocation
  Write-Host "`n=== Verification summary ===" -ForegroundColor Cyan
  if ($script:Results.Count -gt 0) {
    $script:Results | Format-Table -AutoSize | Out-Host
  }
  if ($script:FatalMessage) {
    Write-Host "Fatal: $($script:FatalMessage)" -ForegroundColor Red
  }

  if ($script:HadFailure) {
    Write-Host 'VERDICT: FAIL - Docker runtime stack is not merge-ready.' -ForegroundColor Red
    exit 1
  }
  if ($script:Incomplete) {
    Write-Host 'VERDICT: INCOMPLETE - one or more mandatory merge gates were skipped.' -ForegroundColor Yellow
    exit 2
  }
  Write-Host 'VERDICT: PASS - all verifier gates completed successfully on this checkout.' -ForegroundColor Green
  exit 0
}
