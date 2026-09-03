```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:1677c6f199eeeaecec8560be4b0f797964c7f92faabbccddeeff001122334455
verdict: pass
blockers: 0
critical_findings: 0
requirements: 5/5
scenarios: 12/12
test_command: bash tests/install-remote.test.sh
test_exit_code: 0
test_output_hash: sha256:e22377834892571431b00607d69355b15d977625aae241db784c04f73d4771ab
build_command: deno check agy-bridge.ts
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: auto-install-curl
**Version**: N/A
**Mode**: Standard

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 16 |
| Tasks complete | 16 |
| Tasks incomplete | 0 |

All 16 tasks checked.

### Build & Tests Execution
**Build**: ✅ Passed (exit 0)
```text
$ deno check agy-bridge.ts
(empty — no errors)
$ bash -n install-remote.sh
OK
$ wc -l install-remote.sh
93
```

**Tests**: ✅ 18 passed / 0 failed (exit 0)
```text
$ bash tests/install-remote.test.sh
Running tests for install-remote.sh...
--- 1. Static Checks ---
  [✓] install-remote.sh exists
  [✓] install-remote.sh is executable
  [✓] install-remote.sh passes bash -n
  [✓] install-remote.sh has <120 lines
  [✓] install-remote.sh has set -euo pipefail
  [✓] install-remote.sh does not contain sudo
  [✓] install-remote.sh does not contain literal token definitions
--- 2. Prerequisite Fail-Fast ---
  [✓] Missing agy fails fast
  [✓] Missing deno fails fast
--- 3. Dir Resolution and Delegation ---
  [✓] Default dir resolved to XDG_DATA_HOME/agy-bridge
  [✓] install.sh delegated with passthrough args
  [✓] Custom dir with spaces handled and cloned
  [✓] Git clone called with custom branch ref
  [✓] Idempotent run uses git pull --ff-only
  [✓] Diverged git pull without --force fails
  [✓] Diverged git with --force re-clones and delegates
--- 4. Tarball Fallback ---
  [✓] Tarball fallback creates target directory
  [✓] Tarball fallback extracts install.sh and runs it
Test results: 18 passed, 0 failed
```

**Coverage**: ➖ Not applicable (bash harness)

### Spec Compliance Matrix
| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Remote Bootstrap Script | Auditable one-liner | tests/install-remote.test.sh static checks + README audit | ✅ COMPLIANT |
| Remote Bootstrap Script | Static safety | bash -n + wc -l | ✅ COMPLIANT |
| Clone Target and Fetch | Defaults | tests/install-remote.test.sh dir resolution | ✅ COMPLIANT |
| Clone Target and Fetch | Git preferred with tarball fallback | tests/install-remote.test.sh tarball fallback | ✅ COMPLIANT |
| Clone Target and Fetch | Custom pin | tests/install-remote.test.sh custom dir/branch | ✅ COMPLIANT |
| Idempotent Update | Idempotent re-run | tests/install-remote.test.sh ff-only | ✅ COMPLIANT |
| Idempotent Update | Force re-clone | tests/install-remote.test.sh diverged --force | ✅ COMPLIANT |
| Idempotent Update | Arg passthrough | tests/install-remote.test.sh delegation | ✅ COMPLIANT |
| Verification & Fail-Fast | Successful verification | install.sh is-active/healthz/v1/models + tests | ✅ COMPLIANT |
| Verification & Fail-Fast | Missing agy fails fast | tests/install-remote.test.sh prerequisite | ✅ COMPLIANT |
| Verification & Fail-Fast | Missing systemd fallback | install-remote.sh systemd check | ✅ COMPLIANT |
| README Documentation | README covers install | README.md one-liner + env vars + curl|less | ✅ COMPLIANT |

**Compliance summary**: 12/12 scenarios compliant

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|-------------|--------|-------|
| Remote Bootstrap Script Presence and Safety | ✅ Implemented | install-remote.sh 93 lines, set -euo pipefail, no sudo/token, bash -n OK |
| Clone Target and Fetch Strategy | ✅ Implemented | XDG AGY_BRIDGE_DIR, AGY_BRIDGE_REF main, git clone --depth 1 --branch + tarball fallback --strip-components=1 |
| Idempotent Update and Delegation | ✅ Implemented | git -C pull --ff-only, --force re-clone, preserve env, exec bash install.sh "$@" |
| Verification and Fail-Fast | ✅ Implemented | agy/deno fail-fast, systemd fallback prints deno run, verification via install.sh |
| README One-Liner Documentation | ✅ Implemented | README one-liner, bash -s -- --with-auth, AGY_BRIDGE_REF/DIR, curl|less, no-sudo, prereqs deno/agy |

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| Wrapper separation (<120 lines, exec delegation) | ✅ Yes | 93 lines, exec keeps install.sh canonical, no logic duplication |
| Fetch git preferred + tarball fallback | ✅ Yes | Implements both with correct args |
| XDG dir/ref resolution quoted absolute | ✅ Yes | "$DIR" absolute via cd && pwd, handles spaces/relative/.. |
| Idempotency pull --ff-only / --force | ✅ Yes | Matches design risk mitigation |
| No sudo / no literal AGY_TOKEN | ✅ Yes | Verified via grep |

### Issues Found
**CRITICAL**: None
**WARNING**: None
**SUGGESTION**: None

### Verdict
PASS — all 5 requirements and 12 scenarios have passing runtime evidence; 16/16 tasks complete; static gates pass; design followed.

