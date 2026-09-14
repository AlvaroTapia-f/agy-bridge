[CmdletBinding()]
param(
  [string]$ExpectedHead = '',
  [string]$BaseRef = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expectedBaseRef = '06567660cb765285cf68f28637169c79ddd1aabc'
$expectedMergedPr3Ref = '832d87d32bbc08ed1cb8ef105d41a7c4f27c4a63'

function Invoke-GitCapture {
  param(
    [Parameter(Mandatory = $true)][string[]]$ArgumentList,
    [switch]$AllowFailure,
    [switch]$Quiet
  )

  $savedErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $lines = @(& git @ArgumentList 2>&1)
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
    throw "git $($ArgumentList -join ' ') failed with exit code $exitCode`n$text"
  }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Output = $text
  }
}

$originalLocation = Get-Location
try {
  $root = (Invoke-GitCapture -ArgumentList @('rev-parse', '--show-toplevel') -Quiet).Output.Trim()
  if (-not $root) {
    throw 'not inside the agy-bridge Git checkout'
  }
  Set-Location $root

  # git rev-parse HEAD
  $head = (Invoke-GitCapture -ArgumentList @('rev-parse', 'HEAD') -Quiet).Output.Trim()
  Write-Host "HEAD: $head"
  if ($ExpectedHead -and $head -ne $ExpectedHead) {
    throw "HEAD mismatch: expected $ExpectedHead, got $head"
  }

  $dirty = (Invoke-GitCapture -ArgumentList @(
    'status', '--porcelain', '--untracked-files=all'
  ) -Quiet).Output.Trim()
  if ($dirty) {
    throw "working tree is not clean:`n$dirty"
  }

  if (-not $BaseRef) {
    throw 'Base ref is required. Pass -BaseRef explicitly to the frozen main runtime commit.'
  }
  if ($BaseRef -cne $expectedBaseRef) {
    throw "Base ref mismatch: expected $expectedBaseRef, got $BaseRef"
  }

  Write-Host "Base ref: $BaseRef"
  Invoke-GitCapture -ArgumentList @('cat-file', '-e', "$BaseRef^{commit}") -Quiet | Out-Null
  Invoke-GitCapture -ArgumentList @('cat-file', '-e', "$expectedMergedPr3Ref^{commit}") -Quiet | Out-Null

  $baseParents = (Invoke-GitCapture -ArgumentList @(
    'rev-list', '--parents', '-n', '1', $BaseRef
  ) -Quiet).Output.Trim() -split '\s+'
  if ($baseParents -notcontains $expectedMergedPr3Ref) {
    throw "PR4 base $BaseRef does not directly integrate final merged PR3 $expectedMergedPr3Ref"
  }

  $pr3Ancestor = Invoke-GitCapture -ArgumentList @(
    'merge-base', '--is-ancestor', $expectedMergedPr3Ref, $BaseRef
  ) -AllowFailure -Quiet
  if ($pr3Ancestor.ExitCode -ne 0) {
    throw "Final merged PR3 $expectedMergedPr3Ref is not contained in PR4 base $BaseRef"
  }

  $ancestor = Invoke-GitCapture -ArgumentList @(
    'merge-base', '--is-ancestor', $BaseRef, 'HEAD'
  ) -AllowFailure -Quiet
  if ($ancestor.ExitCode -ne 0) {
    throw "Frozen main base $BaseRef is not an ancestor of HEAD $head"
  }

  # git diff --name-only
  $changedOutput = (Invoke-GitCapture -ArgumentList @(
    'diff', '--name-only', "$BaseRef..HEAD"
  ) -Quiet).Output
  $changedPaths = @($changedOutput -split '[\r\n]+' | Where-Object { $_ })
  $disallowedPaths = @($changedPaths | Where-Object {
    $_ -ne '.dockerignore' -and
    $_ -ne 'Dockerfile' -and
    $_ -ne 'agy-bridge.ts' -and
    $_ -ne 'compose.workspace-rw.yaml' -and
    $_ -ne 'agents/agy-bridge-worker-rw-v1/agent.md' -and
    $_ -ne 'docker/start-bridge.sh' -and
    $_ -ne 'docker/workspace-policy.sh' -and
    $_ -ne 'docker/workspace/verified-rw-agy-versions.txt' -and
    $_ -ne 'docs/superpowers/plans/2026-09-14-read-write-host-workspace-pr4.md' -and
    $_ -ne 'docs/superpowers/specs/2026-09-13-read-write-host-workspace-design.md' -and
    $_ -ne 'docs/docker-compose.md' -and
    $_ -notmatch '^docker/tests/'
  })
  if ($disallowedPaths.Count -gt 0) {
    throw "PR4 diff contains disallowed path(s): $($disallowedPaths -join ', ')"
  }

  # git diff --check
  Invoke-GitCapture -ArgumentList @('diff', '--check', "$BaseRef..HEAD") -Quiet | Out-Null

  Write-Host 'PASS: PR4 repository identity, merged PR3 ancestry, and changed-path scope'
}
finally {
  Set-Location $originalLocation
}
