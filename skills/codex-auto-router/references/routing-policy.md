# Routing policy

## Dynamic model mapping

The router resolves the active model set from CC Switch on every invocation:

1. `CC_SWITCH_MODELS_URL`, `--models-url`, or the configured provider
   `base_url` plus `/models` when available.
2. The `model_catalog_json` path configured in `~/.codex/config.toml`.
3. An explicit `--catalog <path>` used for tests or recovery.

The four custom agent files do not declare `model` or
`model_reasoning_effort`. Catalog selection produces `catalog_candidate`, while
the output `model` and `reasoning_effort` remain null and `model_resolution` is
`catalog_unverified`. The parent checks the current spawn tool's accepted model
and reasoning choices before passing the candidate as explicit overrides. If
either choice is absent, it spawns with inherited settings and records the
degraded resolution. A rejected override gets one retry with inherited settings
for the same tier. Catalog membership alone never proves spawn compatibility.

When the latest GPT family is available, the intended mapping is:

| Tier | Agent | Preferred model | Preferred reasoning |
| --- | --- | --- | --- |
| QUICK | `quick` | `gpt-6-luna` | `high` |
| STANDARD | `standard` | `gpt-6-sol` | `medium` |
| DEEP | `deep` | `gpt-6-sol` | `high` |
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
prefers GPT-6 Luna or fast/mini models for QUICK, GPT-6 Sol, Terra, or pro
models for STANDARD, GPT-6 Sol or pro models for DEEP, and GPT-6 Astra or the
strongest available model for ARCHITECT. It then selects an exact supported reasoning level or the nearest
higher level. If adjacent tiers resolve to the same model, it raises the
stronger tier's reasoning level when a higher level is available so the tiers
remain meaningfully separated.

If GPT-6 Astra is unavailable, ARCHITECT falls back to GPT-6 Sol and raises
reasoning to the next supported level, such as `xhigh`, instead of selecting a
weaker family.
If no catalog can be read, model resolution becomes `unavailable`; use inherited
model settings rather than inventing a slug.

After CC Switch changes provider, start a new Codex task or restart the client
before relying on spawn model overrides. The router itself reads the new live
catalog immediately, but an already-open client session may cache the model
choices exposed by its subagent tool schema.


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
2. `Model override`: the verified `catalog_candidate` model and reasoning effort,
   or `inherited` with the reason session compatibility was unverified or absent.
3. `Outcome`: the observable result the parent needs.
4. `Governing sources`: requirements, issue, files, or design decisions that constrain the work.
5. `Evidence`: what has already been established and what remains unknown.
6. `Write scope`: files or modules the agent may change, or `read-only`.
7. `Validation`: the narrowest checks that prove the result.
8. `Return`: result, files changed, checks run, uncertainty, and `escalation_needed` with exact evidence.

The parent owns final synthesis and acceptance. A subagent must not merely
announce a plan; it executes within its tier or returns a concrete blocker.
