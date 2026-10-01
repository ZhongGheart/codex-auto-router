# Codex Auto Router

Dynamic task-complexity routing for Codex subagents.

`codex-auto-router` selects the cheapest sufficient execution tier for a software-engineering task, proposes a model and reasoning level from the active CC Switch catalog, and escalates only when evidence requires it.

[中文说明](README.zh-CN.md)

## What It Does

```text
User task
   |
   v
codex-auto-router
   |
   +-- deterministic fast path
   |
   +-- TypeSafe System One judgment for ambiguous tasks
   |
   v
quick / standard / deep / architect
   |
   v
catalog model + reasoning candidate
   |
   v
Codex subagent with verified overrides or a fingerprint-matched profile
```

The repository contains:

- a portable Codex Skill
- four custom agent definitions
- a live CC Switch model resolver
- a TypeSafe routing script
- an idempotent installer
- tests and GitHub Actions CI
- a Codex plugin manifest at `.codex-plugin/plugin.json`

## Routing Tiers

| Tier | Job | Typical model family |
| --- | --- | --- |
| `quick` | Search, locate, read, summarize, format, rename, deterministic edits | Luna / Flash / Mini |
| `standard` | Normal feature work, localized fixes, tests, clear-scope implementation | Sol / Terra / Pro |
| `deep` | Difficult diagnosis, cross-module work, performance, concurrency, security, migrations | Sol / Pro |
| `architect` | Whole-system design, cross-service tradeoffs, irreversible decisions, repeated deep failure | Astra / strongest available |

## Dynamic Model Resolution

The router resolves models on every invocation:

1. The active provider `base_url` plus `/models`.
2. `CC_SWITCH_MODELS_URL` or `--models-url` when explicitly supplied.
3. The `model_catalog_json` path from `~/.codex/config.toml`.
4. An explicit `--catalog <path>` for tests or recovery.

When GPT-6.1 Sol is supported by the current session, the preferred mapping is:

```text
quick      -> gpt-6-luna   / high
standard   -> gpt-6.1-sol  / medium
deep       -> gpt-6.1-sol  / high
architect  -> gpt-6-astra  / high
```

GPT-5.6 remains a fallback during rollout:

```text
quick      -> gpt-5.6-luna  / low
standard   -> gpt-5.6-terra / medium
deep       -> gpt-5.6-sol   / high
architect  -> gpt-5.6-sol   / xhigh
```

If GPT-6 Astra is unavailable, `architect` falls back to `gpt-6.1-sol` and raises reasoning to the next supported level, such as `xhigh`. When GPT-6.1 Sol is unavailable, the previous `gpt-6-sol` mapping remains in effect.

When the active catalog contains only DeepSeek models, the router uses:

```text
quick      -> deepseek-flash   / low
standard   -> deepseek-flash   / high
deep       -> deepseek-flash   / max
architect  -> deepseek-v4-pro  / max
```


The repository agent files are stable instruction templates and intentionally omit `model` and `model_reasoning_effort`. The parent supplies the current spawn tool's model-specific choices with `--spawn-capabilities`. The router scores those capabilities into a complete four-tier plan and selects only efforts declared for the chosen model. That current-session plan is authoritative for executable `ready_override` values even when the catalog is stale or from another model family; the catalog candidate/source remain diagnostic. Only when capabilities cannot form a complete plan does the router use installed generated profiles whose state fingerprint exactly matches the active catalog identity and complete route map, and whose fingerprint is visible in all four agent descriptions loaded by the current session (`ready_profile`).

Missing or stale profiles return `restart_required` with a `sync-agents` command and fresh-task/restart instructions. Catalog failures return `unavailable`; invalid profile state returns `blocked`. Inherited parent settings are never reported as successful automatic model routing.

## Requirements

- Codex with custom agent and subagent support
- Node.js 22 or newer
- `TYPESAFE_API_KEY` for semantic routing of ambiguous tasks
- Optional: CC Switch local proxy for dynamic model switching

Deterministic fast paths continue to work without TypeSafe. The parent must preserve any user-explicit model or reasoning choice instead of replacing it with an automatic route. A skill cannot introspect its own spawn schema, reload custom agents, or restart Codex, so the parent supplies session capabilities. Profile synchronization is only for routes unavailable through explicit session overrides and always requires a fresh task or client restart.

## Install

```bash
git clone https://github.com/ZhongGheart/codex-auto-router.git
cd codex-auto-router
./scripts/install.sh
```

The installer:

- installs the Skill into `${AGENTS_HOME:-$HOME/.agents}/skills/codex-auto-router`
- installs canonical agent templates beside the Skill and seeds only missing agents in `${CODEX_HOME:-$HOME/.codex}/agents`
- appends an idempotent `codex-auto-router` routing block to `AGENTS.md`
- backs up existing Skill, Agent, and `AGENTS.md` files before changing them

Start a new Codex task after installation so the global agents load.

## Configure TypeSafe

Set the API key in the environment that launches Codex:

```bash
export TYPESAFE_API_KEY="..."
```

The router calls `https://api.typesafe.ai/v1/systemone` with model `jev-latest` when a task needs semantic classification.

## Usage

After installation, use Codex normally. The global routing instructions and Skill description request automatic routing before substantial software work.

For explicit use:

```text
$codex-auto-router help me diagnose the intermittent login failure and add a regression test
```

Inspect the current mapping:

```bash
node --experimental-strip-types \
  skills/codex-auto-router/scripts/route.ts routes --pretty
```

Supply the current spawn schema when routing (the parent derives this JSON from its tool definition):

```bash
node --experimental-strip-types \
  skills/codex-auto-router/scripts/route.ts route \
  --task "find the authentication middleware" \
  --spawn-capabilities '{"models":[{"model":"gpt-6-luna","reasoning_efforts":["low","medium","high"]}]}' \
  --pretty
```

If the result is `restart_required`, run its `sync_command`, or synchronize directly:

```bash
node --experimental-strip-types \
  skills/codex-auto-router/scripts/route.ts sync-agents --pretty
```

Synchronization validates and stages all four profiles, backs up replaced files, preserves unrelated agents, writes `${CODEX_HOME}/codex-auto-router-state.json`, and appends `[codex-auto-router:<fingerprint>]` to every generated agent description. Start a fresh task or restart the client afterward. From the new spawn schema, extract the one common marker from `quick`, `standard`, `deep`, and `architect`, then pass it on every route and escalation:

```bash
--loaded-profile-fingerprint <sha256>
```

Missing, differing, or stale loaded markers keep the result at `restart_required`, even when the files on disk already match.

Run the local self-test:

```bash
node --experimental-strip-types \
  skills/codex-auto-router/scripts/route.ts selftest
```

## Development

```bash
npm test
```

The tests cover:

- DeepSeek, GPT-6, and GPT-5.6 catalog adaptation
- Astra fallback and reasoning escalation
- live `/v1/models` discovery
- session-authoritative spawn-schema planning, cross-family catalog diagnostics, and explicit resolution states
- atomic generated-profile synchronization, fingerprints, backups, and failure preservation
- plugin manifest completeness
- idempotent installer behavior

## Repository Layout

```text
.codex-plugin/plugin.json
agents/
  quick.toml
  standard.toml
  deep.toml
  architect.toml
skills/codex-auto-router/
  SKILL.md
  references/routing-policy.md
  scripts/route.ts
scripts/install.sh
tests/
```

## Notes

- After switching CC Switch providers or synchronizing profiles, start a new Codex task or restart the client and pass the common loaded-profile fingerprint from the new spawn schema.
- The plugin manifest packages the Skill. The installer is also provided because custom agent TOMLs are installed into the user-level Codex agent directory.
- The router never prints or persists the TypeSafe API key.

## License

MIT
