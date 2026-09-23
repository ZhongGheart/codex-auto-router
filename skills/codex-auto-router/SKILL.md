---
name: codex-auto-router
description: Route software-engineering tasks to the cheapest sufficient Codex subagent tier (quick, standard, deep, architect), with deterministic fast paths, TypeSafe ambiguity judgment, live CC Switch model resolution, and evidence-based escalation. Use before substantial code search, implementation, debugging, review, testing, refactoring, migration, or architecture work; do not use for non-software conversation.
---

# Codex Auto Router

Route software-engineering work to the smallest sufficient execution tier before substantial investigation or edits. Keep the main agent responsible for requirements, scope, synthesis, and final verification.

## Required Resource

Read [references/routing-policy.md](references/routing-policy.md) completely before the first route in a task or whenever the selected tier is challenged. It defines tier boundaries, dynamic model resolution, escalation rules, and subagent prompt requirements.

## Route

1. Preserve any explicit user choice of model, reasoning effort, agent, or execution mode. Routing applies only when the user has not overridden it.
2. Summarize the actual outcome, touched scope, risk, uncertainty, and whether work is read-only or write-heavy.
3. Resolve `SKILL_ROOT` to the absolute directory containing this `SKILL.md`, then run the deterministic plus TypeSafe router:

```bash
printf '%s' "$TASK" | node --experimental-strip-types \
  "$SKILL_ROOT/scripts/route.ts" \
  route --stdin --context "$CONTEXT" --pretty
```

The script selects a catalog candidate from the live CC Switch models endpoint, then falls back to the configured `model_catalog_json` file. A catalog entry does not prove the current session's spawn tool accepts that model. Do not hard-code GPT or DeepSeek model names in prompts or agent files.

Use `--no-typesafe` only when the TypeSafe service is intentionally unavailable or the task is already on the deterministic fast path. Never print or persist the API key.

4. Read the JSON result. Use its `tier`, `agent`, `model_resolution`, `catalog_candidate`, `confidence`, `method`, and `reasons` as the routing decision. `model` and `reasoning_effort` are null until session compatibility is verified.
5. Compare both fields of `catalog_candidate` against the current spawn tool's model and supported reasoning choices. Pass the candidate as explicit spawn overrides only when both are accepted. Otherwise spawn the named custom agent with inherited model settings and record `catalog_unverified` or `unavailable`. If a spawn rejects an override despite that check, retry once with inherited settings for the same tier; do not retry the rejected override.
6. If the custom agent types are missing, run the package installer (`scripts/install.sh`) or copy `agents/*.toml` into `${CODEX_HOME:-$HOME/.codex}/agents/`.
7. Give the subagent a bounded prompt containing: outcome, governing sources, current evidence, allowed write scope, required validation, and required final result. Tell it to return `escalation_needed` with exact evidence rather than drifting outside its tier.
8. After the subagent returns, verify its claims and artifacts in the parent. Close completed subagent threads when they are no longer needed.

For an obviously trivial one-command or one-file task, the parent may execute directly when subagent overhead is larger than the work, but it must use the quick tier's narrow scope and stop if the evidence shows larger scope.

## Escalate

Escalate only for a policy-defined trigger:

```bash
node --experimental-strip-types \
  "$SKILL_ROOT/scripts/route.ts" \
  escalate --current "$CURRENT_TIER" --reason "$REASON" --pretty
```

The escalation result selects a candidate against the same catalog. Apply the same session compatibility check before passing spawn overrides.

Do not escalate merely because a test failed once. Escalate after the same root cause fails at least twice, scope or risk materially expands, security or concurrency is discovered, the result remains uncertain below the confidence threshold, or the current agent declares insufficient context or reasoning.

Never downgrade an already established higher tier to save tokens. The parent owns the final answer and must not delegate final acceptance to the same agent that performed the work.

## Boundaries

- Do not route non-software requests.
- Do not use the router to override a user's explicit model or reasoning choice.
- Do not run TypeSafe for deterministic fast-path tasks; it adds latency without adding a decision.
- Treat router output as a decision aid, not as proof of correctness.
- If model discovery or TypeSafe is unavailable, use the explicit degraded result from the script and record the uncertainty when it could affect quality.
