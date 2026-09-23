# AI handoff

## Current goal

Fix three review findings in `codex-auto-router`: reject stale model mappings that cannot be used by the current session, prevent mixed read/change requests from being sent to `quick`, and update existing routing instructions during installation.

## Starting git state

- Repository: `/Users/yangjin/Documents/Codex/2026-09-21/new-chat/outputs/codex-auto-router`
- Branch: `main`, tracking `origin/main`
- Commit: `57b8f60a16046ee120af7461768a2c611117f81e`
- Working tree: clean before this handoff file was added.

## Current plan

1. Route this implementation task and inspect the current model discovery and installer contracts.
2. Make the smallest changes to the routing script, skill/policy instructions, and installer for the three observed failures.
3. Review the final diff and update this journal with the outcome and any unverified behavior.

## Milestone: task routed

- Router selected `deep` with `deepseek-flash / max` from the local DeepSeek catalog. That model is rejected by this session's spawn tool, so the core implementation agent runs with an inherited model.
- Core agent owns `route.ts`, `SKILL.md`, and `routing-policy.md`; parent owns `install.sh` and this journal.
- The installer fix will replace an existing marked or unmarked routing section with the current canonical block while preserving adjacent sections.

## Next step

## Milestone: installer update

- `scripts/install.sh` now backs up and replaces an existing marked or unmarked router section with the canonical rules, preserving later headings.
- Updated the existing installer assertion in `tests/install.test.mjs` to reflect replacement of stale unmarked content. No tests have been run for this task.

## Next step

## Milestone: core routing and docs

- `route.ts` now returns `catalog_candidate` and `catalog_unverified` with null spawn overrides until the parent checks the current session's tool schema. The Skill and policy describe the check and inherited fallback.
- Mixed retrieval and mutation requests are excluded from deterministic QUICK and have a STANDARD minimum after TypeSafe.
- Updated README files and the existing route assertion to match the new result shape. No tests have been run for this task.

## Next step

Inspect the combined diff for contract mismatches, update the local installation, and record final status.

## Planned local installation

- Run `scripts/install.sh` from this repository after diff review.
- Affected global paths: `~/.agents/skills/codex-auto-router/`, `~/.codex/agents/{quick,standard,deep,architect}.toml`, and the routing section of `~/.codex/AGENTS.md`.
- The installer backs up existing content before replacement. Next step after installation: compare the installed skill with the repository and inspect the resulting routing section.

## Milestone: local installation complete

- Ran `scripts/install.sh`; the installed `route.ts` and `SKILL.md` match the repository copies.
- `~/.codex/AGENTS.md` now contains the updated router block, including the session compatibility check before model overrides. Other sections remain present.
- `git diff --check` reported no whitespace errors. No test suite or route behavior checks were run because the user requested a fix without requesting tests or verification.
- Repository changes remain uncommitted; the working tree contains the code, documentation, existing test assertion updates, and this handoff file.

## Remaining consideration

An already-running Codex session may retain its spawn tool's model choices. New sessions will load the updated Skill and rules; model candidates still require comparison with the session's accepted choices.
