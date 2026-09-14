#!/usr/bin/env bash
set -euo pipefail

production_files=(
  "agy-bridge.ts"
  "Dockerfile"
  "compose.yaml"
  "compose.workspace.yaml"
  "compose.workspace-rw.yaml"
  "docker/start-bridge.sh"
  "docker/workspace-policy.sh"
  "agents/agy-bridge-worker-ro-v1/agent.md"
  "agents/agy-bridge-worker-rw-v1/agent.md"
)

forbidden_patterns=(
  'read_file(*)'
  'write_file(*)'
  'command(*)'
  '--dangerously-skip-permissions'
  '--allow-read=/workspace'
  '--allow-write=/workspace'
)

failed=0
rw_agent="agents/agy-bridge-worker-rw-v1/agent.md"

for path in "${production_files[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "missing production file: $path" >&2
    failed=1
  fi
done

for pattern in "${forbidden_patterns[@]}"; do
  if grep -nF -- "$pattern" "${production_files[@]}"; then
    echo "forbidden workspace security pattern found: $pattern" >&2
    failed=1
  fi
done

if grep -nF -- 'run_command' agents/agy-bridge-worker-rw-v1/agent.md; then
  echo 'dedicated RW workspace agent must not expose run_command' >&2
  failed=1
fi

actual_rw_frontmatter="$(awk '
  NR == 1 && $0 == "---" { in_frontmatter=1; next }
  in_frontmatter && $0 == "---" { exit }
  in_frontmatter { print }
' "$rw_agent")"
expected_rw_frontmatter="$(cat <<'EOF'
name: agy-bridge-worker-rw-v1
description: Read-write bridge workspace worker for the explicitly mounted Docker workspace.
tools:
  - view_file
  - list_dir
  - grep_search
  - find_by_name
  - write_to_file
  - replace_file_content
  - multi_replace_file_content
mainAgent: true
subagent: false
commandExecutionPolicy: off
mcpServers: []
skills: []
plugins: []
EOF
)"
if [[ "$actual_rw_frontmatter" != "$expected_rw_frontmatter" ]]; then
  echo 'dedicated RW workspace agent frontmatter differs from the approved capability manifest' >&2
  diff -u \
    <(printf '%s\n' "$expected_rw_frontmatter") \
    <(printf '%s\n' "$actual_rw_frontmatter") >&2 || true
  failed=1
fi

if grep -nF -- 'command(' docker/workspace-policy.sh; then
  echo 'workspace production policy must not contain command permissions' >&2
  failed=1
fi

if (( failed != 0 )); then
  exit 1
fi

echo "PASS: workspace production sources contain no forbidden security patterns"
