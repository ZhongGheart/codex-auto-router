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

if ! grep -q '^# BEGIN codex-auto-router$' "$AGENTS_FILE" 2>/dev/null; then
  if [ -f "$AGENTS_FILE" ]; then
    mkdir -p "$BACKUP_DIR"
    cp -p "$AGENTS_FILE" "$BACKUP_DIR/AGENTS.md"
  fi
  {
    echo
    echo '# BEGIN codex-auto-router'
    echo '## Automatic model and reasoning routing'
    echo
    echo 'For software-engineering tasks in a repository, activate and follow the `codex-auto-router` skill before substantial investigation or edits.'
    echo
    echo '- Preserve explicit user choices for model, reasoning effort, agent, or execution mode.'
    echo '- Use the deterministic fast path for obvious retrieval or mechanical work and use TypeSafe only for ambiguous routing decisions.'
    echo '- Delegate to the exact custom agent selected by the router: `quick`, `standard`, `deep`, or `architect`.'
    echo '- Pass the router'"'"'s resolved `model` and `reasoning_effort` as explicit spawn overrides so the mapping follows the current CC Switch model catalog.'
    echo '- Keep the parent agent responsible for requirements, scope, synthesis, and final verification.'
    echo '- Escalate only for policy-defined triggers such as repeated same-root-cause failure, material scope or risk expansion, discovered security/concurrency risk, low routing confidence, or explicit insufficient-context reporting.'
    echo '- Never downgrade an already established higher tier merely to reduce tokens.'
    echo '# END codex-auto-router'
  } >> "$AGENTS_FILE"
fi

echo "Installed codex-auto-router"
echo "  skill:  $SKILL_DEST"
echo "  agents: $AGENT_DEST"
echo "  rules:  $AGENTS_FILE"
echo "Start a new Codex task after installation so the global agents load."
