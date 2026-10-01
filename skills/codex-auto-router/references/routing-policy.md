# Routing policy

## Dynamic model mapping

The router resolves the active model set from CC Switch on every invocation:

1. `CC_SWITCH_MODELS_URL`, `--models-url`, or the configured provider
   `base_url` plus `/models` when available.
2. The `model_catalog_json` path configured in `~/.codex/config.toml`.
3. An explicit `--catalog <path>` used for tests or recovery.

Repository agent files are stable instruction templates and do not declare
`model` or `model_reasoning_effort`. The parent supplies the current tool schema
through `--spawn-capabilities`. The router builds and scores a four-tier plan
from those model-specific capabilities, selecting only exact supported efforts.
When that plan is complete, the current session schema is authoritative for
execution. Catalog membership alone never proves spawn compatibility; the
catalog candidate and source remain diagnostic when they are stale or disjoint.

Execution states are explicit:

- `ready_override`: the complete current-session plan accepts the exact selected
  model and effort. Both override fields are non-null.
- `ready_profile`: installed generated profiles and the state fingerprint exactly
  match the active catalog identity and normalized four-tier route map, and
  `--loaded-profile-fingerprint` exactly matches the common marker exposed by
  all four loaded agent descriptions in the current spawn schema. Override fields
  stay null because the named agent profile owns them.
- `restart_required`: session capabilities could not produce a complete plan and
  the required catalog-backed profiles are missing or stale. Run the returned
  `sync_command`, then start a fresh task or restart the client.
- `unavailable`: neither session capabilities nor catalog discovery produced a
  complete executable mapping.
- `blocked`: capability input or generated profile state cannot be validated.

Inherited parent settings are never a successful routing state and are not a
retry path after an override rejection.

When the latest GPT family is available, the intended mapping is:

| Tier | Agent | Preferred model | Preferred reasoning |
| --- | --- | --- | --- |
| QUICK | `quick` | `gpt-6-luna` | `high` |
| STANDARD | `standard` | `gpt-6.1-sol` | `medium` |
| DEEP | `deep` | `gpt-6.1-sol` | `high` |
| ARCHITECT | `architect` | `gpt-6-astra` | `high` |

When GPT-6 is unavailable but GPT-5.6 is present, the router falls back to:

| Tier | Agent | Fallback model | Fallback reasoning |
| --- | --- | --- | --- |
| QUICK | `quick` | `gpt-5.6-luna` | `low` |
| STANDARD | `standard` | `gpt-5.6-terra` | `medium` |
| DEEP | `deep` | `gpt-5.6-sol` | `high` |
| ARCHITECT | `architect` | `gpt-5.6-sol` | `xhigh` |

When the active catalog contains only DeepSeek models, the router uses:

| Tier | Agent | Resolved model | Resolved reasoning |
| --- | --- | --- | --- |
| QUICK | `quick` | `deepseek-flash` | `low` |
| STANDARD | `standard` | `deepseek-flash` | `high` |
| DEEP | `deep` | `deepseek-flash` | `max` |
| ARCHITECT | `architect` | `deepseek-v4-pro` | `max` |

The script scores model identifiers and display names by family intent. It
prefers GPT-6 Luna or fast/mini models for QUICK, GPT-6.1 Sol ahead of GPT-6 Sol,
Terra, or pro models for STANDARD and DEEP, and GPT-6 Astra or the
strongest available model for ARCHITECT. It then selects an exact supported reasoning level or the nearest
higher level. If adjacent tiers resolve to the same model, it raises the
stronger tier's reasoning level when a higher level is available so the tiers
remain meaningfully separated.

If GPT-6 Astra is unavailable, ARCHITECT falls back to GPT-6.1 Sol when available,
otherwise GPT-6 Sol, and raises
reasoning to the next supported level, such as `xhigh`, instead of selecting a
weaker family.
If GPT-6.1 Sol is absent, the previous GPT-6 Sol mapping remains in effect.
If no catalog can be read, validated session capabilities may still yield
`ready_override`. Otherwise model resolution becomes `unavailable`; do not
invent a slug or claim success through inherited settings.

`sync-agents` validates all four routes and templates before it writes, stages
the four generated TOMLs plus `${CODEX_HOME}/codex-auto-router-state.json`, backs
up files it will replace, and commits the state marker last. The fingerprint is
SHA-256 over the normalized route map plus non-secret catalog/provider identity.
Every generated agent description preserves its human-readable text and appends
`[codex-auto-router:<fingerprint>]`, making the loaded fingerprint observable in
a fresh session's spawn tool schema.
Unrelated agent files are preserved. Discovery or generation failure leaves the
previous installation untouched.

Profile synchronization is only for routes unavailable through explicit current-
session overrides. After CC Switch changes provider or profiles are synchronized,
start a new Codex task or restart the client. The router can read the new catalog immediately, but
a skill cannot introspect or refresh the spawn schema, reload custom agents, or
restart Codex. Disk-matching profiles without the exact loaded fingerprint remain
`restart_required`, preventing same-session post-sync false success.


## Deterministic fast path

The router should avoid TypeSafe when the task is already unambiguous:

- `quick`: explicit search, locate, read, list, grep, summarize, format, rename,
  or a single known mechanical change with no behavioral risk. A request that
  combines retrieval with deletion, editing, replacement, or another mutation
  is not a deterministic quick route. The same mixed signal sets a STANDARD
  minimum if TypeSafe returns QUICK.
- `deep`: explicit security, concurrency, race, deadlock, performance,
  cross-module, migration, or difficult root-cause language.
- `architect`: explicit whole-system architecture, cross-system redesign,
  platform-wide migration, irreversible change, or major public-contract
  decision.

Normal feature implementation and ordinary bug fixes are routed through TypeSafe
when the router cannot resolve them from an explicit fast-path signal.

## Tier boundaries

### QUICK

Use when the answer is mostly retrieval or a deterministic transformation.
The quick agent must not design architecture, alter public contracts, make
security decisions, or perform broad refactors. It reports an escalation rather
than guessing when those boundaries appear.

### STANDARD

Use when the desired behavior is clear enough to implement and verify locally.
The standard agent inspects relevant code, makes the smallest coherent change,
runs appropriate validation, and escalates when the change crosses a module or
contract boundary.

### DEEP

Use when causality, risk, or scope is not local. The deep agent traces behavior
end-to-end, checks assumptions and edge cases, considers regressions, and
prefers correctness over speed. It owns difficult diagnosis and cross-module
implementation but does not make a system-wide architectural decision without
escalating.

### ARCHITECT

Use sparingly. The architect agent compares credible approaches, checks
consequences and failure modes, and produces the final architectural decision.
It is not a general-purpose coding tier and must not be selected merely because
the task is large.

## Escalation rules

Move exactly one tier by default:

```text
quick -> standard -> deep -> architect
```

Escalate when any of these is true:

- the same root cause has failed at least two attempts;
- the task expands from a bounded change into a cross-module or cross-service change;
- security, concurrency, data corruption, or irreversible migration risk is discovered;
- the selected agent explicitly reports insufficient context or reasoning;
- TypeSafe confidence is below `0.65` and the resulting tier is not already architect;
- a public or cross-boundary contract decision is required.

Do not escalate because of a single ordinary compile error, a formatting failure,
or an expected red test before the agent has investigated it. Do not downgrade a
tier after it has been selected.

## Subagent prompt contract

Every routed subagent prompt should include:

1. `Tier`: the selected tier and reason.
2. `Model execution`: the exact overrides for `ready_override`, or the
   fingerprint-matched named profile for `ready_profile`.
3. `Outcome`: the observable result the parent needs.
4. `Governing sources`: requirements, issue, files, or design decisions that constrain the work.
5. `Evidence`: what has already been established and what remains unknown.
6. `Write scope`: files or modules the agent may change, or `read-only`.
7. `Validation`: the narrowest checks that prove the result.
8. `Return`: result, files changed, checks run, uncertainty, and `escalation_needed` with exact evidence.

The parent owns final synthesis and acceptance. A subagent must not merely
announce a plan; it executes within its tier or returns a concrete blocker.
