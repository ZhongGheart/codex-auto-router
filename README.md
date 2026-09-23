# Codex Auto Router

Dynamic task-complexity routing for Codex subagents.

`codex-auto-router` selects the cheapest sufficient execution tier for a software-engineering task, resolves the current model and reasoning level from the active CC Switch catalog, and escalates only when evidence requires it.

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
live model + reasoning resolution
   |
   v
Codex subagent with explicit model overrides
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

The latest GPT mapping follows the official OpenAI model guidance:

```text
quick      -> gpt-6-luna   / high
standard   -> gpt-6-sol    / medium
deep       -> gpt-6-sol    / high
architect  -> gpt-6-astra  / high
```

GPT-5.6 remains a fallback during rollout:

```text
quick      -> gpt-5.6-luna  / low
standard   -> gpt-5.6-terra / medium
deep       -> gpt-5.6-sol   / high
architect  -> gpt-5.6-sol   / xhigh
```

If GPT-6 Astra is unavailable, `architect` falls back to `gpt-6-sol` and raises reasoning to the next supported level, such as `xhigh`.

The custom agent files intentionally omit `model` and `model_reasoning_effort`. The parent passes the resolved values as explicit spawn overrides, so switching CC Switch providers does not require editing the agents.

## Requirements

- Codex with custom agent and subagent support
- Node.js 22 or newer
- `TYPESAFE_API_KEY` for semantic routing of ambiguous tasks
- Optional: CC Switch local proxy for dynamic model switching

Deterministic fast paths continue to work without TypeSafe. If model discovery fails, the router returns `model_resolution: unavailable` and uses inherited model settings instead of inventing a slug.

## Install

```bash
git clone https://github.com/ZhongGheart/codex-auto-router.git
cd codex-auto-router
./scripts/install.sh
```

The installer:

- installs the Skill into `${AGENTS_HOME:-$HOME/.agents}/skills/codex-auto-router`
- installs the four agents into `${CODEX_HOME:-$HOME/.codex}/agents`
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

- After switching CC Switch providers, start a new Codex task or restart the client before relying on spawn model overrides.
- The plugin manifest packages the Skill. The installer is also provided because custom agent TOMLs are installed into the user-level Codex agent directory.
- The router never prints or persists the TypeSafe API key.

## License

MIT
