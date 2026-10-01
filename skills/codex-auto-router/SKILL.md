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

The script selects a diagnostic catalog candidate from the live CC Switch models endpoint, then falls back to the configured `model_catalog_json` file. A catalog entry does not prove the current session's spawn tool accepts that model. Read the current `spawn_agent` tool schema and pass its model-specific choices as validated JSON:

```bash
--spawn-capabilities '{"models":[{"model":"MODEL","reasoning_efforts":["low","medium","high"]}]}'
```

The skill cannot introspect its own spawn schema, reload custom agents, or restart Codex. The parent must supply this session capability input. When it yields a complete four-tier plan, these current-session capabilities are authoritative for executable model and effort selection; a stale or disjoint catalog remains diagnostic and must not force profile synchronization. Do not hard-code provider model names in prompts or stable agent templates.

Also inspect the loaded `quick`, `standard`, `deep`, and `architect` descriptions in the current `spawn_agent` schema. Generated profiles end with a marker such as `[codex-auto-router:<sha256>]`. Only when all four descriptions expose one identical marker, pass it on every route and escalation:

```bash
--loaded-profile-fingerprint <sha256>
```

If the descriptions have no marker, different markers, or a marker that differs from the route result, the current session has stale profiles and must not use `ready_profile`.

Use `--no-typesafe` only when the TypeSafe service is intentionally unavailable or the task is already on the deterministic fast path. Never print or persist the API key.

4. Read the JSON result. Use its `tier`, `agent`, `model_resolution`, `catalog_candidate`, `confidence`, `method`, and `reasons` as the routing decision:
   - `ready_override`: pass the non-null `model` and `reasoning_effort` as explicit spawn overrides.
   - `ready_profile`: spawn the named agent without overrides; its installed profile and the common fingerprint observed in this session's four loaded descriptions match the active mapping.
   - `restart_required`: current-session capabilities could not produce a complete executable plan. Run the returned `sync_command`, then stop and ask for a fresh task or client restart before delegating.
   - `unavailable` or `blocked`: report the returned reason and do not claim successful model routing.
5. Never treat inherited parent settings as a successful route or retry. If `ready_override` is rejected despite the schema check, report `blocked`; the current tool schema and runtime disagree.
6. If custom agent types are missing, run the package installer (`scripts/install.sh`). If profiles are missing or stale, use the router's `sync-agents` command; it validates all four mappings before replacing profiles.
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

The escalation result resolves through the same capability/profile states. Act only on `ready_override` or `ready_profile`.

Do not escalate merely because a test failed once. Escalate after the same root cause fails at least twice, scope or risk materially expands, security or concurrency is discovered, the result remains uncertain below the confidence threshold, or the current agent declares insufficient context or reasoning.

Never downgrade an already established higher tier to save tokens. The parent owns the final answer and must not delegate final acceptance to the same agent that performed the work.

## Boundaries

- Do not route non-software requests.
- Do not use the router to override a user's explicit model or reasoning choice.
- If the user explicitly chose a model or reasoning effort, preserve it and do not substitute a catalog route or generated profile.
- Do not run TypeSafe for deterministic fast-path tasks; it adds latency without adding a decision.
- Treat router output as a decision aid, not as proof of correctness.
- A skill cannot refresh the parent tool schema or loaded custom-agent definitions. Synchronization always requires a fresh task or client restart; disk state alone never proves `ready_profile` in the current session.
- If model discovery or profile validation is unavailable, preserve the visible failure state; do not fall back to inherited execution.
