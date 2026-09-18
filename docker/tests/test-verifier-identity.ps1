[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expectedBase = 'bcf2f2532be7d32a78167d745a700f8a480114e0'
$oldBase = '7c59fd382953560f9a04e6a2cfadeb510a1804f7'
$prePr1 = '94430e6f0288c78191d31ba308f2c572c3cf8041'
$identityScript = Join-Path $PSScriptRoot 'assert-pr3-identity.ps1'

if (-not (Test-Path $identityScript)) {
  throw "missing identity gate under test: $identityScript"
}

function Invoke-Git {
  param(
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [string]$WorkingDirectory = ''
  )

  $originalLocation = Get-Location
  try {
    if ($WorkingDirectory) { Set-Location $WorkingDirectory }
    $savedErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = 'Continue'
      $lines = @(& git @ArgumentList 2>&1)
      $exitCode = $LASTEXITCODE
    }
    finally {
      $ErrorActionPreference = $savedErrorActionPreference
    }
  }
  finally {
    Set-Location $originalLocation
  }

  $text = ($lines | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
  if ($exitCode -ne 0) {
    throw "git $($ArgumentList -join ' ') failed with exit code $exitCode`n$text"
  }
  return $text.Trim()
}

function Invoke-Identity {
  param(
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$BaseRef
  )

  $originalLocation = Get-Location
  try {
    Set-Location $WorkingDirectory
    try {
      $output = @(& $identityScript -BaseRef $BaseRef 2>&1)
      return [pscustomobject]@{
        Passed = $true
        Output = ($output | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
      }
    }
    catch {
      return [pscustomobject]@{
        Passed = $false
        Output = $_.Exception.Message
      }
    }
  }
  finally {
    Set-Location $originalLocation
  }
}

function Assert-Pass {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)]$Result
  )
  if (-not $Result.Passed) {
    throw "$Name unexpectedly failed: $($Result.Output)"
  }
  Write-Host "PASS: $Name"
}

function Assert-Fail {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)]$Result,
    [Parameter(Mandatory = $true)][string]$MessagePattern
  )
  if ($Result.Passed) {
    throw "$Name unexpectedly passed"
  }
  if ($Result.Output -notmatch $MessagePattern) {
    throw "$Name failed for the wrong reason: $($Result.Output)"
  }
  Write-Host "PASS: $Name rejected as expected"
}

$repoRoot = Invoke-Git -ArgumentList @('rev-parse', '--show-toplevel')
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "agy-pr3-identity-$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$allowedWorktree = Join-Path $tempRoot 'allowed'
$nonAncestorWorktree = Join-Path $tempRoot 'non-ancestor'
$disallowedWorktree = Join-Path $tempRoot 'disallowed'
$worktrees = @()

try {
  New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null

  Invoke-Git -WorkingDirectory $repoRoot -ArgumentList @('worktree', 'add', '--detach', $allowedWorktree, $expectedBase) | Out-Null
  $worktrees += $allowedWorktree
  New-Item -ItemType Directory -Force -Path (Join-Path $allowedWorktree 'docker/tests') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $allowedWorktree 'docs') | Out-Null
  New-Item -ItemType Directory -Force -Path (Join-Path $allowedWorktree '.github/workflows') | Out-Null
  Set-Content -NoNewline -Path (Join-Path $allowedWorktree 'docker/tests/identity-allowed.txt') -Value 'allowed verifier test change'
  Set-Content -NoNewline -Path (Join-Path $allowedWorktree 'docs/docker-compose.md') -Value 'allowed docs change'
  Set-Content -NoNewline -Path (Join-Path $allowedWorktree '.github/workflows/linux-docker-deterministic.yml') -Value 'name: allowed workflow change'
  Invoke-Git -WorkingDirectory $allowedWorktree -ArgumentList @('add', 'docker/tests/identity-allowed.txt', 'docs/docker-compose.md', '.github/workflows/linux-docker-deterministic.yml') | Out-Null
  Invoke-Git -WorkingDirectory $allowedWorktree -ArgumentList @(
    '-c', 'user.name=PR3 Identity Test',
    '-c', 'user.email=pr3-identity-test@example.invalid',
    'commit', '-m', 'test: allowed PR3 identity fixture'
  ) | Out-Null

  # allowed verifier/docs/workflow diff
  Assert-Pass -Name 'allowed verifier/docs/workflow diff' -Result (Invoke-Identity -WorkingDirectory $allowedWorktree -BaseRef $expectedBase)

  $untrackedCanary = Join-Path $allowedWorktree "LOCAL-ONLY-UNTRACKED-$([Guid]::NewGuid().ToString('N')).txt"
  Set-Content -NoNewline -Path $untrackedCanary -Value 'arbitrary local-only file'

  # arbitrary untracked local state
  Assert-Fail -Name 'arbitrary untracked local file' -Result (Invoke-Identity -WorkingDirectory $allowedWorktree -BaseRef $expectedBase) -MessagePattern 'working tree is not clean'
  Remove-Item -Force $untrackedCanary

  # wrong frozen base
  Assert-Fail -Name 'wrong frozen base' -Result (Invoke-Identity -WorkingDirectory $allowedWorktree -BaseRef $oldBase) -MessagePattern 'Base ref mismatch'

  Invoke-Git -WorkingDirectory $repoRoot -ArgumentList @('worktree', 'add', '--detach', $nonAncestorWorktree, $prePr1) | Out-Null
  $worktrees += $nonAncestorWorktree

  # non-ancestor base
  Assert-Fail -Name 'non-ancestor base' -Result (Invoke-Identity -WorkingDirectory $nonAncestorWorktree -BaseRef $expectedBase) -MessagePattern 'not an ancestor'

  Invoke-Git -WorkingDirectory $repoRoot -ArgumentList @('worktree', 'add', '--detach', $disallowedWorktree, $expectedBase) | Out-Null
  $worktrees += $disallowedWorktree
  Set-Content -NoNewline -Path (Join-Path $disallowedWorktree 'BLOCKER3-DISALLOWED.txt') -Value 'disallowed PR3 path'
  Invoke-Git -WorkingDirectory $disallowedWorktree -ArgumentList @('add', 'BLOCKER3-DISALLOWED.txt') | Out-Null
  Invoke-Git -WorkingDirectory $disallowedWorktree -ArgumentList @(
    '-c', 'user.name=PR3 Identity Test',
    '-c', 'user.email=pr3-identity-test@example.invalid',
    'commit', '-m', 'test: disallowed PR3 identity fixture'
  ) | Out-Null

  # disallowed changed path
  Assert-Fail -Name 'disallowed changed path' -Result (Invoke-Identity -WorkingDirectory $disallowedWorktree -BaseRef $expectedBase) -MessagePattern 'disallowed path'

  Write-Host 'PASS: PR3 identity regression scenarios'
}
finally {
  foreach ($worktree in $worktrees) {
    try {
      Invoke-Git -WorkingDirectory $repoRoot -ArgumentList @('worktree', 'remove', '--force', $worktree) | Out-Null
    }
    catch {
      Write-Warning "failed to remove temporary worktree $worktree`: $($_.Exception.Message)"
    }
  }
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tempRoot
}
