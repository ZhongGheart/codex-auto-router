#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
AGENTS_HOME="${AGENTS_HOME:-$HOME/.agents}"
SKILL_SOURCE="$ROOT/skills/codex-auto-router"
SKILL_DEST="$AGENTS_HOME/skills/codex-auto-router"
AGENT_DEST="$CODEX_HOME/agents"
AGENTS_FILE="$CODEX_HOME/AGENTS.md"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="$CODEX_HOME/backups/codex-auto-router-install-$STAMP"

mkdir -p "$SKILL_DEST" "$AGENT_DEST" "$(dirname "$AGENTS_FILE")"

if [ -d "$SKILL_DEST" ]; then
  mkdir -p "$BACKUP_DIR/skill"
  cp -R "$SKILL_DEST/." "$BACKUP_DIR/skill/"
fi

for name in quick standard deep architect; do
  if [ -f "$AGENT_DEST/$name.toml" ]; then
    mkdir -p "$BACKUP_DIR/agents"
    cp -p "$AGENT_DEST/$name.toml" "$BACKUP_DIR/agents/$name.toml"
  fi
done

cp -R "$SKILL_SOURCE/." "$SKILL_DEST/"
chmod +x "$SKILL_DEST/scripts/route.ts"

for name in quick standard deep architect; do
  cp "$ROOT/agents/$name.toml" "$AGENT_DEST/$name.toml"
done

if [ -f "$AGENTS_FILE" ]; then
  mkdir -p "$BACKUP_DIR"
  cp -p "$AGENTS_FILE" "$BACKUP_DIR/AGENTS.md"
else
  touch "$AGENTS_FILE"
fi

ROUTING_BLOCK="$(mktemp "${AGENTS_FILE}.block.XXXXXX")"
UPDATED_AGENTS="$(mktemp "${AGENTS_FILE}.updated.XXXXXX")"
trap 'rm -f "$ROUTING_BLOCK" "$UPDATED_AGENTS"' EXIT

cat > "$ROUTING_BLOCK" <<'EOF'
# BEGIN codex-auto-router
## Automatic model and reasoning routing

For software-engineering tasks in a repository, activate and follow the `codex-auto-router` skill before substantial investigation or edits.

- Preserve explicit user choices for model, reasoning effort, agent, or execution mode.
- Use the deterministic fast path for obvious retrieval or mechanical work and use TypeSafe only for ambiguous routing decisions.
- Delegate to the exact custom agent selected by the router: `quick`, `standard`, `deep`, or `architect`.
- Pass the router's resolved `model` and `reasoning_effort` as explicit spawn overrides only when both are accepted by the current session's spawn tool; otherwise use inherited settings and record the degraded mapping.
- Keep the parent agent responsible for requirements, scope, synthesis, and final verification.
- Escalate only for policy-defined triggers such as repeated same-root-cause failure, material scope or risk expansion, discovered security/concurrency risk, low routing confidence, or explicit insufficient-context reporting.
- Never downgrade an already established higher tier merely to reduce tokens.
# END codex-auto-router
EOF

awk -v block_file="$ROUTING_BLOCK" '
  function emit_block( line) {
    if (inserted) return
    while ((getline line < block_file) > 0) print line
    close(block_file)
    inserted = 1
  }
  /^# BEGIN codex-auto-router$/ { emit_block(); in_marked_section = 1; next }
  in_marked_section {
    if ($0 == "# END codex-auto-router") in_marked_section = 0
    next
  }
  /^## Automatic model and reasoning routing$/ { emit_block(); in_unmarked_section = 1; next }
  in_unmarked_section {
    if ($0 ~ /^##? /) {
      in_unmarked_section = 0
      print ""
      print
    }
    next
  }
  { print }
  END {
    if (!inserted) {
      print ""
      emit_block()
    }
  }
' "$AGENTS_FILE" > "$UPDATED_AGENTS"
cat "$UPDATED_AGENTS" > "$AGENTS_FILE"

echo "Installed codex-auto-router"
echo "  skill:  $SKILL_DEST"
echo "  agents: $AGENT_DEST"
echo "  rules:  $AGENTS_FILE"
echo "Start a new Codex task after installation so the global agents load."
