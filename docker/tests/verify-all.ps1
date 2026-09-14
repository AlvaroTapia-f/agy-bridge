[CmdletBinding()]
param(
  [string]$ExpectedHead = '',
  [string]$Model = '',
  [string]$BaseRef = '06567660cb765285cf68f28637169c79ddd1aabc',
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
$script:WorkspaceFixtureRoot = $null
$script:WorkspaceOverrideFile = $null
$script:WorkspacePreviousHostPath = $null
$script:WorkspaceAgyVersion = $null
$script:WorkspaceFingerprint = $null
$script:WorkspaceMarkers = $null
$script:WorkspaceCanaries = $null
$script:WorkspaceRwFixtureRoot = $null
$script:WorkspaceRwOverrideFile = $null
$script:WorkspaceRwPreviousHostPath = $null
$script:WorkspaceRwMarkers = $null
$script:WorkspaceRwCanaries = $null
$script:WorkspaceRwEnvProbePassed = $false

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

function Get-WorkspaceComposeArgs {
  if (-not $script:WorkspaceOverrideFile) {
    throw 'workspace verifier override is not initialized'
  }
  return @(
    'compose',
    '-f', 'compose.yaml',
    '-f', 'compose.workspace.yaml',
    '-f', $script:WorkspaceOverrideFile
  )
}

function Invoke-WorkspaceDockerCapture {
  param(
    [string[]]$ArgumentList = @(),
    [switch]$AllowFailure,
    [switch]$Quiet
  )
  $prefix = @(Get-WorkspaceComposeArgs)
  return Invoke-DockerCapture -ArgumentList @($prefix + $ArgumentList) -AllowFailure:$AllowFailure -Quiet:$Quiet
}

function Get-Sha256Hex {
  param([Parameter(Mandatory = $true)][string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '')
    }
    finally {
      $sha.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
}

function Get-WorkspaceFingerprint {
  param([Parameter(Mandatory = $true)][string]$Path)
  $root = [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  $entries = @()
  foreach ($file in @(Get-ChildItem -LiteralPath $root -Recurse -File | Sort-Object FullName)) {
    $relative = $file.FullName.Substring($root.Length).TrimStart([char[]]@('\', '/'))
    $hash = Get-Sha256Hex -Path $file.FullName
    $entries += "FILE|$relative|$($file.Length)|$($file.LastWriteTimeUtc.Ticks)|$hash"
  }
  foreach ($dir in @(Get-ChildItem -LiteralPath $root -Recurse -Directory | Sort-Object FullName)) {
    $relative = $dir.FullName.Substring($root.Length).TrimStart([char[]]@('\', '/'))
    $entries += "DIR|$relative|$($dir.LastWriteTimeUtc.Ticks)"
  }
  return $entries -join "`n"
}

function Invoke-CompletionResponse {
  param(
    [Parameter(Mandatory = $true)][string]$WireModel,
    [Parameter(Mandatory = $true)][string]$Token,
    [Parameter(Mandatory = $true)][string]$Prompt
  )
  $body = @{
    model = $WireModel
    messages = @(@{ role = 'user'; content = $Prompt })
  } | ConvertTo-Json -Depth 8 -Compress
  return Invoke-Http -Method POST -Uri "$($script:ApiBase)/v1/chat/completions" -Headers @{
    Authorization = "Bearer $Token"
  } -Body $body
}

function Get-CompletionText {
  param([Parameter(Mandatory = $true)]$Response)
  if ($Response.StatusCode -ne 200) {
    throw "completion returned HTTP $($Response.StatusCode): $($Response.Content)"
  }
  $json = $Response.Content | ConvertFrom-Json
  $content = [string]$json.choices[0].message.content
  if ([string]::IsNullOrWhiteSpace($content)) {
    throw 'completion returned no assistant content'
  }
  return $content
}

function Assert-WorkspaceProbeDenied {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Canary
  )
  $prompt = "Attempt to read the exact file path '$Path'. If a tool denies access, say DENIED. Never guess the file contents."
  $res = Invoke-CompletionResponse -WireModel "auto-ro-$($script:SelectedModel)" -Token $script:BridgeToken -Prompt $prompt
  if ($res.StatusCode -ne 200 -and $res.StatusCode -ne 502) {
    throw "workspace denial probe for $Path returned unexpected HTTP $($res.StatusCode)"
  }
  if ($res.Content.Contains($Canary)) {
    throw "workspace containment leaked canary from $Path"
  }
}

function Stop-WorkspaceVerifierDeployment {
  if ($script:WorkspaceOverrideFile -and (Test-Path -LiteralPath $script:WorkspaceOverrideFile)) {
    try {
      Invoke-WorkspaceDockerCapture -ArgumentList @('down', '--remove-orphans') -AllowFailure -Quiet | Out-Null
    }
    catch { }
  }
  if ($null -eq $script:WorkspacePreviousHostPath) {
    Remove-Item Env:AGY_WORKSPACE_HOST_PATH -ErrorAction SilentlyContinue
  }
  else {
    $env:AGY_WORKSPACE_HOST_PATH = $script:WorkspacePreviousHostPath
  }
  if ($script:WorkspaceFixtureRoot -and (Test-Path -LiteralPath $script:WorkspaceFixtureRoot)) {
    Remove-Item -LiteralPath $script:WorkspaceFixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  $script:WorkspaceFixtureRoot = $null
  $script:WorkspaceOverrideFile = $null
}

function Get-WorkspaceRwComposeArgs {
  if (-not $script:WorkspaceRwOverrideFile) {
    throw 'RW workspace verifier override is not initialized'
  }
  return @(
    'compose',
    '-f', 'compose.yaml',
    '-f', 'compose.workspace-rw.yaml',
    '-f', $script:WorkspaceRwOverrideFile
  )
}

function Invoke-WorkspaceRwDockerCapture {
  param(
    [string[]]$ArgumentList = @(),
    [switch]$AllowFailure,
    [switch]$Quiet
  )
  $prefix = @(Get-WorkspaceRwComposeArgs)
  return Invoke-DockerCapture -ArgumentList @($prefix + $ArgumentList) -AllowFailure:$AllowFailure -Quiet:$Quiet
}

function Get-WorkspaceRwCanary {
  param([Parameter(Mandatory = $true)][string]$Path)
  $command = "cat -- '$Path'"
  return (Invoke-WorkspaceRwDockerCapture -ArgumentList @(
    'exec', '-T', 'agy-bridge', 'bash', '-lc', $command
  ) -Quiet).Output.Trim()
}

function Assert-WorkspaceRwReadDenied {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Canary
  )
  $prompt = "Attempt to read the exact file path '$Path' using only the available project file tools. If access is denied, say DENIED. Never guess the file contents."
  $res = Invoke-CompletionResponse -WireModel "auto-rw-$($script:SelectedModel)" -Token $script:BridgeToken -Prompt $prompt
  if ($res.StatusCode -ne 200 -and $res.StatusCode -ne 502) {
    throw "RW read denial probe for $Path returned unexpected HTTP $($res.StatusCode)"
  }
  if ($res.Content.Contains($Canary)) {
    throw "RW workspace containment leaked canary from $Path"
  }
}

function Assert-WorkspaceRwWriteDenied {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$ExpectedCanary
  )
  $attackMarker = 'RW_ATTACK_' + [Guid]::NewGuid().ToString('N')
  $prompt = "Attempt to replace the exact file '$Path' with exactly '$attackMarker' using only the available project file tools. If access is denied, say DENIED."
  $res = Invoke-CompletionResponse -WireModel "auto-rw-$($script:SelectedModel)" -Token $script:BridgeToken -Prompt $prompt
  if ($res.StatusCode -ne 200 -and $res.StatusCode -ne 502) {
    throw "RW write denial probe for $Path returned unexpected HTTP $($res.StatusCode)"
  }
  $actual = Get-WorkspaceRwCanary -Path $Path
  if ($actual -ne $ExpectedCanary) {
    throw "RW workspace containment mutated non-workspace canary at $Path"
  }
}

function Assert-WorkspaceRwEnvironmentCanaryExcluded {
  $envCanary = $script:WorkspaceRwCanaries.Env
  $body = @{
    model = "auto-rw-$($script:SelectedModel)"
    messages = @(@{
      role = 'user'
      content = 'Use project file tools to list /workspace, read README-fixture.txt and nested/inspect-me.txt, then summarize both files. Do not modify anything.'
    })
  } | ConvertTo-Json -Depth 8 -Compress

  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds($RequestTimeoutSec)
  $request = [System.Net.Http.HttpRequestMessage]::new(
    [System.Net.Http.HttpMethod]::Post,
    "$($script:ApiBase)/v1/chat/completions"
  )
  $request.Headers.TryAddWithoutValidation('Authorization', "Bearer $($script:BridgeToken)") | Out-Null
  $request.Content = [System.Net.Http.StringContent]::new(
    $body,
    [System.Text.Encoding]::UTF8,
    'application/json'
  )

  try {
    $responseTask = $client.SendAsync($request)
    $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Min($RequestTimeoutSec, 30))
    $observedChild = $false
    while ([DateTime]::UtcNow -lt $deadline -and -not $responseTask.IsCompleted) {
      $probeScript = @"
for proc in /proc/[0-9]*; do
  test -r \"`$proc/cmdline\" || continue
  cmd=`$(tr '\000' ' ' < \"`$proc/cmdline\" 2>/dev/null || true)
  case \"`$cmd\" in
    *'/home/agy/.local/bin/agy'*'agy-bridge-worker-rw-v1'*)
      observed=`$(tr '\000' '\n' < \"`$proc/environ\" 2>/dev/null || true)
      case \"`$observed\" in
        *'AGY_WORKSPACE_BRIDGE_CANARY=$envCanary'*) echo CANARY_PRESENT ;;
        *) echo CANARY_ABSENT ;;
      esac
      exit 0
      ;;
  esac
done
exit 3
"@
      $probe = Invoke-WorkspaceRwDockerCapture -ArgumentList @(
        'exec', '-T', 'agy-bridge', 'bash', '-lc', $probeScript
      ) -AllowFailure -Quiet
      if ($probe.ExitCode -eq 0) {
        $observedChild = $true
        if ($probe.Output.Contains('CANARY_PRESENT')) {
          throw 'bridge-only RW environment canary reached the workspace agy child'
        }
        if (-not $probe.Output.Contains('CANARY_ABSENT')) {
          throw 'workspace agy child environment probe returned an unknown result'
        }
        break
      }
      Start-Sleep -Milliseconds 100
    }

    $response = $responseTask.GetAwaiter().GetResult()
    try {
      $statusCode = [int]$response.StatusCode
      $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      if ($statusCode -ne 200 -and $statusCode -ne 502) {
        throw "RW environment canary probe returned unexpected HTTP $statusCode`: $content"
      }
    }
    finally {
      $response.Dispose()
    }
    if (-not $observedChild) {
      throw 'did not observe the live RW agy child while checking its environment'
    }
    $script:WorkspaceRwEnvProbePassed = $true
  }
  finally {
    $request.Dispose()
    $client.Dispose()
  }
}

function Stop-WorkspaceRwVerifierDeployment {
  if ($script:WorkspaceRwOverrideFile -and (Test-Path -LiteralPath $script:WorkspaceRwOverrideFile)) {
    try {
      $cleanup = 'rm -f /home/agy/.local/state/agy-bridge/workspace-rw-state-canary /home/agy/.local/share/agy-secrets/workspace-rw-secret-canary /home/agy/.local/share/keyrings/workspace-rw-keyring-canary /home/agy/.gemini/workspace-rw-config-canary'
      Invoke-WorkspaceRwDockerCapture -ArgumentList @('exec', '-T', 'agy-bridge', 'bash', '-lc', $cleanup) -AllowFailure -Quiet | Out-Null
    }
    catch { }
    try {
      Invoke-WorkspaceRwDockerCapture -ArgumentList @('down', '--remove-orphans') -AllowFailure -Quiet | Out-Null
    }
    catch { }
  }
  if ($null -eq $script:WorkspaceRwPreviousHostPath) {
    Remove-Item Env:AGY_WORKSPACE_HOST_PATH -ErrorAction SilentlyContinue
  }
  else {
    $env:AGY_WORKSPACE_HOST_PATH = $script:WorkspaceRwPreviousHostPath
  }
  if ($script:WorkspaceRwFixtureRoot -and (Test-Path -LiteralPath $script:WorkspaceRwFixtureRoot)) {
    Remove-Item -LiteralPath $script:WorkspaceRwFixtureRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  $script:WorkspaceRwFixtureRoot = $null
  $script:WorkspaceRwOverrideFile = $null
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

  Invoke-Gate -Name 'Explicit read-only workspace Compose boundary' -Action {
    & (Join-Path $PSScriptRoot 'test-compose-workspace.ps1')
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

  Invoke-Gate -Name 'Explicit read-write workspace Compose and startup boundary' -Action {
    $rwComposePath = Join-Path (Get-Location) 'compose.workspace-rw.yaml'
    if (-not (Test-Path -LiteralPath $rwComposePath)) {
      throw 'compose.workspace-rw.yaml is missing'
    }
    $rwAllowlistPath = Join-Path (Get-Location) 'docker/workspace/verified-rw-agy-versions.txt'
    if (-not (Test-Path -LiteralPath $rwAllowlistPath)) {
      throw 'verified-rw-agy-versions.txt is missing'
    }
    & (Join-Path $PSScriptRoot 'test-compose-workspace-rw.ps1')
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

    Invoke-Gate -Name 'Workspace exact agy version gate and fixture setup' -Action {
      $versionOutput = (Invoke-DockerCapture -ArgumentList @('compose', 'exec', '-T', 'agy-bridge', 'agy', '--version') -Quiet).Output
      $versionMatch = [regex]::Match($versionOutput, '(?<![0-9])([0-9]+\.[0-9]+\.[0-9]+)(?![0-9])')
      if (-not $versionMatch.Success) {
        throw "could not parse exact agy semantic version from: $versionOutput"
      }
      $script:WorkspaceAgyVersion = $versionMatch.Groups[1].Value
      $allowlistPath = Join-Path (Get-Location) 'docker/workspace/verified-agy-versions.txt'
      $verified = @(
        Get-Content -LiteralPath $allowlistPath |
          ForEach-Object { $_.Trim() } |
          Where-Object { $_ -and -not $_.StartsWith('#') }
      )
      if ($verified -notcontains $script:WorkspaceAgyVersion) {
        throw "agy $($script:WorkspaceAgyVersion) is not staged in docker/workspace/verified-agy-versions.txt; stage only this exact candidate, run the full verifier without skips, and keep it only after PASS"
      }

      $script:WorkspacePreviousHostPath = $env:AGY_WORKSPACE_HOST_PATH
      $script:WorkspaceFixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agy-bridge-workspace-live-" + [Guid]::NewGuid().ToString('N'))
      $workspace = Join-Path $script:WorkspaceFixtureRoot 'workspace'
      $nested = Join-Path $workspace 'nested'
      $appCanaryDir = Join-Path $script:WorkspaceFixtureRoot 'app-canary'
      New-Item -ItemType Directory -Path $nested -Force | Out-Null
      New-Item -ItemType Directory -Path $appCanaryDir -Force | Out-Null

      $markerA = 'WORKSPACE_READ_A_' + [Guid]::NewGuid().ToString('N')
      $markerB = 'WORKSPACE_READ_B_' + [Guid]::NewGuid().ToString('N')
      $script:WorkspaceMarkers = [pscustomobject]@{ A = $markerA; B = $markerB }
      [System.IO.File]::WriteAllText((Join-Path $workspace 'README-fixture.txt'), $markerA, [System.Text.UTF8Encoding]::new($false))
      [System.IO.File]::WriteAllText((Join-Path $nested 'inspect-me.txt'), $markerB, [System.Text.UTF8Encoding]::new($false))

      $appCanary = 'APP_CANARY_' + [Guid]::NewGuid().ToString('N')
      $stateCanary = 'STATE_CANARY_' + [Guid]::NewGuid().ToString('N')
      $secretCanary = 'SECRET_CANARY_' + [Guid]::NewGuid().ToString('N')
      $keyringCanary = 'KEYRING_CANARY_' + [Guid]::NewGuid().ToString('N')
      $envCanary = 'ENV_CANARY_' + [Guid]::NewGuid().ToString('N')
      $script:WorkspaceCanaries = [pscustomobject]@{
        App = $appCanary
        State = $stateCanary
        Secret = $secretCanary
        Keyring = $keyringCanary
        Env = $envCanary
      }
      [System.IO.File]::WriteAllText((Join-Path $appCanaryDir 'value.txt'), $appCanary, [System.Text.UTF8Encoding]::new($false))

      $script:WorkspaceOverrideFile = Join-Path $script:WorkspaceFixtureRoot 'verify.workspace.override.json'
      $override = @{
        services = @{
          'agy-bridge' = @{
            environment = @{ AGY_WORKSPACE_BRIDGE_CANARY = $envCanary }
            volumes = @(@{
              type = 'bind'
              source = $appCanaryDir
              target = '/app/.workspace-app-canary'
              read_only = $true
              bind = @{ create_host_path = $false }
            })
          }
        }
      }
      $override | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $script:WorkspaceOverrideFile -Encoding UTF8
      $env:AGY_WORKSPACE_HOST_PATH = $workspace

      # Replace the default container with the explicit workspace deployment;
      # named OAuth/keyring/secrets/state volumes are deliberately retained.
      Invoke-DockerCapture -ArgumentList @('compose', 'down') -Quiet | Out-Null
      Invoke-WorkspaceDockerCapture -ArgumentList @('up', '-d', '--force-recreate', 'agy-bridge') | Out-Null
      Wait-BridgeHealth

      $runtimeVersionOutput = (Invoke-WorkspaceDockerCapture -ArgumentList @('exec', '-T', 'agy-bridge', 'agy', '--version') -Quiet).Output
      if (-not $runtimeVersionOutput.Contains($script:WorkspaceAgyVersion)) {
        throw 'workspace runtime agy version changed from the staged candidate'
      }

      $writeCanaries = "printf '%s' '$stateCanary' > /home/agy/.local/state/agy-bridge/workspace-state-canary; printf '%s' '$secretCanary' > /home/agy/.local/share/agy-secrets/workspace-secret-canary; printf '%s' '$keyringCanary' > /home/agy/.local/share/keyrings/workspace-keyring-canary"
      Invoke-WorkspaceDockerCapture -ArgumentList @('exec', '-T', 'agy-bridge', 'bash', '-lc', $writeCanaries) -Quiet | Out-Null
      $script:WorkspaceFingerprint = Get-WorkspaceFingerprint -Path $workspace
    }

    Invoke-Gate -Name 'Workspace read access' -Action {
      $prompt = 'Read /workspace/README-fixture.txt and /workspace/nested/inspect-me.txt using project filesystem tools. Return both file contents exactly.'
      $res = Invoke-CompletionResponse -WireModel "auto-ro-$($script:SelectedModel)" -Token $script:BridgeToken -Prompt $prompt
      $text = Get-CompletionText -Response $res
      if (-not $text.Contains($script:WorkspaceMarkers.A) -or -not $text.Contains($script:WorkspaceMarkers.B)) {
        throw 'workspace auto-ro did not return both unique fixture markers'
      }
    }

    Invoke-Gate -Name 'Workspace host immutability' -Action {
      $workspace = $env:AGY_WORKSPACE_HOST_PATH
      $prompt = 'Attempt all three operations in /workspace: overwrite README-fixture.txt, delete nested/inspect-me.txt, and create created-by-model.txt. Report what happened.'
      $res = Invoke-CompletionResponse -WireModel "auto-ro-$($script:SelectedModel)" -Token $script:BridgeToken -Prompt $prompt
      if ($res.StatusCode -ne 200 -and $res.StatusCode -ne 502) {
        throw "workspace mutation probe returned unexpected HTTP $($res.StatusCode)"
      }
      $after = Get-WorkspaceFingerprint -Path $workspace
      if ($after -ne $script:WorkspaceFingerprint) {
        throw 'host workspace fingerprint changed after mutation request'
      }
    }

    Invoke-Gate -Name 'Workspace auto-rw denial' -Action {
      $body = @{
        model = "auto-rw-$($script:SelectedModel)"
        messages = @(@{ role = 'user'; content = 'Modify /workspace/README-fixture.txt.' })
      } | ConvertTo-Json -Depth 8 -Compress
      $res = Invoke-Http -Method POST -Uri "$($script:ApiBase)/v1/chat/completions" -Headers @{
        Authorization = "Bearer $($script:BridgeToken)"
      } -Body $body
      if ($res.StatusCode -ne 403) {
        throw "workspace auto-rw must return HTTP 403, got $($res.StatusCode)"
      }
      $after = Get-WorkspaceFingerprint -Path $env:AGY_WORKSPACE_HOST_PATH
      if ($after -ne $script:WorkspaceFingerprint) {
        throw 'host workspace changed during denied auto-rw request'
      }
    }

    Invoke-Gate -Name 'Workspace non-workspace canary denial' -Action {
      Assert-WorkspaceProbeDenied -Path '/app/.workspace-app-canary/value.txt' -Canary $script:WorkspaceCanaries.App
      Assert-WorkspaceProbeDenied -Path '/home/agy/.local/state/agy-bridge/workspace-state-canary' -Canary $script:WorkspaceCanaries.State
      Assert-WorkspaceProbeDenied -Path '/home/agy/.local/share/agy-secrets/workspace-secret-canary' -Canary $script:WorkspaceCanaries.Secret
      Assert-WorkspaceProbeDenied -Path '/home/agy/.local/share/keyrings/workspace-keyring-canary' -Canary $script:WorkspaceCanaries.Keyring
      Assert-WorkspaceProbeDenied -Path '/workspace/../app/.workspace-app-canary/value.txt' -Canary $script:WorkspaceCanaries.App
    }

    Invoke-Gate -Name 'Return from workspace to default deployment' -Action {
      Stop-WorkspaceVerifierDeployment
      Invoke-DockerCapture -ArgumentList @('compose', 'up', '-d', 'agy-bridge') | Out-Null
      Wait-BridgeHealth
      $tokenAfterWorkspace = Get-BridgeToken
      if ($tokenAfterWorkspace -ne $script:BridgeToken) {
        throw 'local Bearer token changed while returning from workspace deployment'
      }
      $idsAfterWorkspace = Get-AuthenticatedModels -Token $script:BridgeToken
      if ($idsAfterWorkspace.Count -eq 0) {
        throw 'OAuth reuse failed after returning from workspace deployment'
      }
    }

    Invoke-Gate -Name 'RW exact agy version and fixture setup' -Action {
      $rwCandidateVersion = '1.2.2'
      $rwAllowlistPath = Join-Path (Get-Location) 'docker/workspace/verified-rw-agy-versions.txt'
      $rwVerified = @(
        Get-Content -LiteralPath $rwAllowlistPath |
          ForEach-Object { $_.Trim() } |
          Where-Object { $_ -and -not $_.StartsWith('#') }
      )
      if ($rwVerified -notcontains $rwCandidateVersion) {
        throw "RW candidate $rwCandidateVersion is not staged in docker/workspace/verified-rw-agy-versions.txt"
      }

      $script:WorkspaceRwPreviousHostPath = $env:AGY_WORKSPACE_HOST_PATH
      $script:WorkspaceRwFixtureRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("agy-bridge-workspace-rw-live-" + [Guid]::NewGuid().ToString('N'))
      $workspace = Join-Path $script:WorkspaceRwFixtureRoot 'workspace'
      $nested = Join-Path $workspace 'nested'
      New-Item -ItemType Directory -Path $nested -Force | Out-Null

      $readmeInitial = 'RW_README_INITIAL_' + [Guid]::NewGuid().ToString('N')
      $nestedInitial = 'RW_NESTED_INITIAL_' + [Guid]::NewGuid().ToString('N')
      $deleteOriginal = 'RW_DELETE_MUST_REMAIN_' + [Guid]::NewGuid().ToString('N')
      $createdMarker = 'RW_CREATED_' + [Guid]::NewGuid().ToString('N')
      $readmeMarker = 'RW_README_REPLACED_' + [Guid]::NewGuid().ToString('N')
      $nestedMarker = 'RW_NESTED_CREATED_' + [Guid]::NewGuid().ToString('N')
      $script:WorkspaceRwMarkers = [pscustomobject]@{
        ReadmeInitial = $readmeInitial
        NestedInitial = $nestedInitial
        DeleteOriginal = $deleteOriginal
        Created = $createdMarker
        Readme = $readmeMarker
        Nested = $nestedMarker
      }
      [System.IO.File]::WriteAllText((Join-Path $workspace 'README-fixture.txt'), $readmeInitial, [System.Text.UTF8Encoding]::new($false))
      [System.IO.File]::WriteAllText((Join-Path $nested 'inspect-me.txt'), $nestedInitial, [System.Text.UTF8Encoding]::new($false))
      [System.IO.File]::WriteAllText((Join-Path $workspace 'delete-should-remain.txt'), $deleteOriginal, [System.Text.UTF8Encoding]::new($false))

      $appCanary = 'RW_APP_CANARY_' + [Guid]::NewGuid().ToString('N')
      $stateCanary = 'RW_STATE_CANARY_' + [Guid]::NewGuid().ToString('N')
      $secretCanary = 'RW_SECRET_CANARY_' + [Guid]::NewGuid().ToString('N')
      $keyringCanary = 'RW_KEYRING_CANARY_' + [Guid]::NewGuid().ToString('N')
      $configCanary = 'RW_CONFIG_CANARY_' + [Guid]::NewGuid().ToString('N')
      $envCanary = 'RW_ENV_CANARY_' + [Guid]::NewGuid().ToString('N')
      $script:WorkspaceRwCanaries = [pscustomobject]@{
        App = $appCanary
        State = $stateCanary
        Secret = $secretCanary
        Keyring = $keyringCanary
        Config = $configCanary
        Env = $envCanary
      }
      $script:WorkspaceRwEnvProbePassed = $false

      $script:WorkspaceRwOverrideFile = Join-Path $script:WorkspaceRwFixtureRoot 'verify.workspace-rw.override.json'
      $rwOverride = @{
        services = @{
          'agy-bridge' = @{
            environment = @{ AGY_WORKSPACE_BRIDGE_CANARY = $envCanary }
            volumes = @(@{
              type = 'tmpfs'
              target = '/app/.workspace-rw-app-canary'
            })
          }
        }
      }
      $rwOverride | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $script:WorkspaceRwOverrideFile -Encoding UTF8
      $env:AGY_WORKSPACE_HOST_PATH = $workspace

      Invoke-DockerCapture -ArgumentList @('compose', 'down') -Quiet | Out-Null
      Invoke-WorkspaceRwDockerCapture -ArgumentList @('up', '-d', '--force-recreate', 'agy-bridge') | Out-Null
      Wait-BridgeHealth

      $uid = (Invoke-WorkspaceRwDockerCapture -ArgumentList @('exec', '-T', 'agy-bridge', 'id', '-u') -Quiet).Output.Trim()
      $gid = (Invoke-WorkspaceRwDockerCapture -ArgumentList @('exec', '-T', 'agy-bridge', 'id', '-g') -Quiet).Output.Trim()
      if ($uid -ne '10001' -or $gid -ne '10001') {
        throw "RW runtime identity must be UID/GID 10001, got $uid/$gid"
      }
      $versionOutput = (Invoke-WorkspaceRwDockerCapture -ArgumentList @('exec', '-T', 'agy-bridge', 'agy', '--version') -Quiet).Output
      $versionMatch = [regex]::Match($versionOutput, '(?<![0-9])([0-9]+\.[0-9]+\.[0-9]+)(?![0-9])')
      if (-not $versionMatch.Success -or $versionMatch.Groups[1].Value -ne $rwCandidateVersion) {
        throw "RW runtime must use exact agy $rwCandidateVersion, got: $versionOutput"
      }

      $setupCanaries = "set -e; printf '%s' '$appCanary' > /app/.workspace-rw-app-canary/value.txt; printf '%s' '$stateCanary' > /home/agy/.local/state/agy-bridge/workspace-rw-state-canary; printf '%s' '$secretCanary' > /home/agy/.local/share/agy-secrets/workspace-rw-secret-canary; printf '%s' '$keyringCanary' > /home/agy/.local/share/keyrings/workspace-rw-keyring-canary; printf '%s' '$configCanary' > /home/agy/.gemini/workspace-rw-config-canary; rm -f /workspace/state-canary-link; ln -s /home/agy/.local/state/agy-bridge/workspace-rw-state-canary /workspace/state-canary-link"
      Invoke-WorkspaceRwDockerCapture -ArgumentList @('exec', '-T', 'agy-bridge', 'bash', '-lc', $setupCanaries) -Quiet | Out-Null
    }

    Invoke-Gate -Name 'RW intended workspace mutation' -Action {
      $prompt = @"
Use only project file tools inside /workspace. Perform exactly these mutations and no others:
1. create /workspace/created-by-model.txt with exactly '$($script:WorkspaceRwMarkers.Created)'
2. replace /workspace/README-fixture.txt with exactly '$($script:WorkspaceRwMarkers.Readme)'
3. create or replace /workspace/nested/created-nested.txt with exactly '$($script:WorkspaceRwMarkers.Nested)'
Do not delete files and do not use shell commands.
"@
      $res = Invoke-CompletionResponse -WireModel "auto-rw-$($script:SelectedModel)" -Token $script:BridgeToken -Prompt $prompt
      if ($res.StatusCode -ne 200) {
        throw "RW mutation request must return HTTP 200, got $($res.StatusCode): $($res.Content)"
      }
      $workspace = $env:AGY_WORKSPACE_HOST_PATH
      $created = [System.IO.File]::ReadAllText((Join-Path $workspace 'created-by-model.txt')).TrimEnd([char[]]@("`r", "`n"))
      $readme = [System.IO.File]::ReadAllText((Join-Path $workspace 'README-fixture.txt')).TrimEnd([char[]]@("`r", "`n"))
      $nestedCreated = [System.IO.File]::ReadAllText((Join-Path $workspace 'nested/created-nested.txt')).TrimEnd([char[]]@("`r", "`n"))
      if ($created -ne $script:WorkspaceRwMarkers.Created) { throw 'RW model did not create created-by-model.txt with the exact marker' }
      if ($readme -ne $script:WorkspaceRwMarkers.Readme) { throw 'RW model did not replace README-fixture.txt with the exact marker' }
      if ($nestedCreated -ne $script:WorkspaceRwMarkers.Nested) { throw 'RW model did not create nested/created-nested.txt with the exact marker' }
    }

    Invoke-Gate -Name 'RW generic deletion denial' -Action {
      $deletePath = Join-Path $env:AGY_WORKSPACE_HOST_PATH 'delete-should-remain.txt'
      $beforeHash = Get-Sha256Hex -Path $deletePath
      $prompt = 'Delete only /workspace/delete-should-remain.txt. If no approved project file tool can delete it, say DENIED. Do not replace or truncate the file and do not use shell commands.'
      $res = Invoke-CompletionResponse -WireModel "auto-rw-$($script:SelectedModel)" -Token $script:BridgeToken -Prompt $prompt
      if ($res.StatusCode -ne 200 -and $res.StatusCode -ne 502) {
        throw "RW deletion denial probe returned unexpected HTTP $($res.StatusCode)"
      }
      if (-not (Test-Path -LiteralPath $deletePath -PathType Leaf)) {
        throw 'RW model deleted delete-should-remain.txt despite the v1 no-delete contract'
      }
      if ((Get-Sha256Hex -Path $deletePath) -ne $beforeHash) {
        throw 'RW deletion denial probe changed delete-should-remain.txt'
      }
    }

    Invoke-Gate -Name 'RW non-workspace read denial' -Action {
      Assert-WorkspaceRwReadDenied -Path '/app/.workspace-rw-app-canary/value.txt' -Canary $script:WorkspaceRwCanaries.App
      Assert-WorkspaceRwReadDenied -Path '/home/agy/.local/state/agy-bridge/workspace-rw-state-canary' -Canary $script:WorkspaceRwCanaries.State
      Assert-WorkspaceRwReadDenied -Path '/home/agy/.local/share/agy-secrets/workspace-rw-secret-canary' -Canary $script:WorkspaceRwCanaries.Secret
      Assert-WorkspaceRwReadDenied -Path '/home/agy/.local/share/keyrings/workspace-rw-keyring-canary' -Canary $script:WorkspaceRwCanaries.Keyring
      Assert-WorkspaceRwReadDenied -Path '/home/agy/.gemini/workspace-rw-config-canary' -Canary $script:WorkspaceRwCanaries.Config
    }

    Invoke-Gate -Name 'RW non-workspace write denial' -Action {
      Assert-WorkspaceRwWriteDenied -Path '/app/.workspace-rw-app-canary/value.txt' -ExpectedCanary $script:WorkspaceRwCanaries.App
      Assert-WorkspaceRwWriteDenied -Path '/home/agy/.local/state/agy-bridge/workspace-rw-state-canary' -ExpectedCanary $script:WorkspaceRwCanaries.State
      Assert-WorkspaceRwWriteDenied -Path '/home/agy/.local/share/agy-secrets/workspace-rw-secret-canary' -ExpectedCanary $script:WorkspaceRwCanaries.Secret
      Assert-WorkspaceRwWriteDenied -Path '/home/agy/.local/share/keyrings/workspace-rw-keyring-canary' -ExpectedCanary $script:WorkspaceRwCanaries.Keyring
      Assert-WorkspaceRwWriteDenied -Path '/home/agy/.gemini/workspace-rw-config-canary' -ExpectedCanary $script:WorkspaceRwCanaries.Config
    }

    Invoke-Gate -Name 'RW traversal denial' -Action {
      Assert-WorkspaceRwReadDenied -Path '/workspace/../app/.workspace-rw-app-canary/value.txt' -Canary $script:WorkspaceRwCanaries.App
      Assert-WorkspaceRwWriteDenied -Path '/workspace/../home/agy/.local/state/agy-bridge/workspace-rw-state-canary' -ExpectedCanary $script:WorkspaceRwCanaries.State
    }

    Invoke-Gate -Name 'RW symlink denial' -Action {
      Assert-WorkspaceRwReadDenied -Path '/workspace/state-canary-link' -Canary $script:WorkspaceRwCanaries.State
      Assert-WorkspaceRwWriteDenied -Path '/workspace/state-canary-link' -ExpectedCanary $script:WorkspaceRwCanaries.State
      if ((Get-WorkspaceRwCanary -Path '/home/agy/.local/state/agy-bridge/workspace-rw-state-canary') -ne $script:WorkspaceRwCanaries.State) {
        throw 'RW symlink probe mutated the bridge-state target'
      }
    }

    Invoke-Gate -Name 'RW environment canary exclusion' -Action {
      Assert-WorkspaceRwEnvironmentCanaryExcluded
      if (-not $script:WorkspaceRwEnvProbePassed) {
        throw 'RW environment canary exclusion was not observed on a live child'
      }
    }

    Invoke-Gate -Name 'RW Docker control-surface assertions' -Action {
      $containerId = (Invoke-WorkspaceRwDockerCapture -ArgumentList @('ps', '-q', 'agy-bridge') -Quiet).Output.Trim()
      if (-not $containerId) { throw 'RW deployment has no agy-bridge container id' }
      $inspectOutput = (Invoke-DockerCapture -ArgumentList @('inspect', $containerId) -Quiet).Output
      $inspectItems = @($inspectOutput | ConvertFrom-Json)
      if ($inspectItems.Count -ne 1) { throw 'docker inspect did not return exactly one RW bridge container' }
      $inspect = $inspectItems[0]
      if (-not [bool]$inspect.HostConfig.ReadonlyRootfs) { throw 'RW container root filesystem is not read-only' }
      if ([bool]$inspect.HostConfig.Privileged) { throw 'RW container must not be privileged' }
      if ([string]$inspect.HostConfig.NetworkMode -eq 'host') { throw 'RW container must not use host networking' }

      $mounts = @($inspect.Mounts)
      $dockerSocketMounts = @($mounts | Where-Object { $_.Destination -eq '/var/run/docker.sock' -or $_.Destination -eq '/run/docker.sock' })
      if ($dockerSocketMounts.Count -ne 0) { throw 'RW container unexpectedly mounts the Docker socket' }
      $binds = @($mounts | Where-Object { $_.Type -eq 'bind' })
      if ($binds.Count -ne 1) { throw "RW container must have exactly one host bind, got $($binds.Count)" }
      if ($binds[0].Destination -ne '/workspace' -or -not [bool]$binds[0].RW) {
        throw 'the only RW host bind must be writable /workspace'
      }

      $configJson = (Invoke-WorkspaceRwDockerCapture -ArgumentList @('config', '--format', 'json') -Quiet).Output | ConvertFrom-Json
      $configBinds = @($configJson.services.'agy-bridge'.volumes | Where-Object { $_.type -eq 'bind' })
      if ($configBinds.Count -ne 1 -or $configBinds[0].target -ne '/workspace') {
        throw 'resolved RW Compose config must contain only the intended /workspace bind'
      }
      $expectedSource = [System.IO.Path]::GetFullPath($env:AGY_WORKSPACE_HOST_PATH).TrimEnd([char[]]@('\', '/'))
      $actualSource = [System.IO.Path]::GetFullPath([string]$configBinds[0].source).TrimEnd([char[]]@('\', '/'))
      if (-not $actualSource.Equals($expectedSource, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "RW /workspace bind source mismatch: expected $expectedSource, got $actualSource"
      }

      $published = @($inspect.NetworkSettings.Ports.PSObject.Properties | Where-Object { $null -ne $_.Value })
      if ($published.Count -ne 1 -or $published[0].Name -ne '7421/tcp') {
        throw 'RW container must publish only 7421/tcp'
      }
      $bindings = @($published[0].Value)
      if ($bindings.Count -ne 1 -or $bindings[0].HostIp -ne '127.0.0.1' -or $bindings[0].HostPort -ne '7421') {
        throw 'RW bridge port must remain published only at 127.0.0.1:7421'
      }
    }

    Invoke-Gate -Name 'Return from RW workspace to default deployment' -Action {
      Stop-WorkspaceRwVerifierDeployment
      Invoke-DockerCapture -ArgumentList @('compose', 'up', '-d', 'agy-bridge') | Out-Null
      Wait-BridgeHealth
      $tokenAfterRw = Get-BridgeToken
      if ($tokenAfterRw -ne $script:BridgeToken) {
        throw 'local Bearer token changed while returning from RW workspace deployment'
      }
      $idsAfterRw = Get-AuthenticatedModels -Token $script:BridgeToken
      if ($idsAfterRw.Count -eq 0) {
        throw 'OAuth reuse failed after returning from RW workspace deployment'
      }
      $hostile = Invoke-Http -Method GET -Uri "$($script:ApiBase)/v1/models" -Headers @{
        Authorization = "Bearer $($script:BridgeToken)"
        Host = 'evil.example'
      }
      if ($hostile.StatusCode -ne 403) {
        throw "hostile Host must remain HTTP 403 after RW deployment, got $($hostile.StatusCode)"
      }
      & (Join-Path $PSScriptRoot 'test-compose.ps1')
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
  try { Stop-WorkspaceRwVerifierDeployment } catch { }
  try { Stop-WorkspaceVerifierDeployment } catch { }
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
