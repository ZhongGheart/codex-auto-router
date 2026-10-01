# AI handoff

## Current goal

Make `codex-auto-router` a real automatic model selector: use explicit model/reasoning overrides when the current spawn schema supports them, use generated provider-matched agent profiles when it does not, require a fresh session after profile synchronization, and stop treating inherited execution as successful routing.

## Starting git state

- Repository: `/Users/yangjin/Documents/Codex/2026-09-21/new-chat/outputs/codex-auto-router`
- Branch: `main`, tracking `origin/main`
- Commit: `d247aa4bf97a5c41a6d8d3ebeb29772fa5714a93`
- Working tree: clean before this handoff update.

## Current plan

1. Route the implementation task and lock the observable contracts with failing tests.
2. Add spawn-capability resolution, explicit route states, generated profile synchronization, state fingerprinting, and visible restart/block behavior.
3. Update the installer and documentation, run focused and full validation, then synchronize the global installation.
4. Review the final diff and record remaining runtime limitations, especially cached tool schemas and model-runtime observability.

## Milestone: automatic-model-selector implementation started

- Confirmed the active global config uses `gpt-5.6-sol / medium`, while the default local catalog contains only DeepSeek models and the current spawn schema accepts GPT-family overrides.
- The accepted design uses `ready_override` for session-verified explicit overrides, `ready_profile` for validated generated profiles, `restart_required` for missing/stale profiles, and `unavailable`/`blocked` for failures. Inherited execution is not a success state.
- Planned write scope: `route.ts`, agent templates/generation support, installer, routing policy and README files, tests/fixtures, and this journal. Global installation is updated only after repository validation.

## Next step

Run the router for the implementation request, delegate to the selected execution tier, and add RED tests for the new resolution states and profile synchronization.

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

## Milestone: robust selector implementation resumed

- Reconciled the journal against commit `d247aa4bf97a5c41a6d8d3ebeb29772fa5714a93`, `git status`, and the filesystem. The only working-tree change at resume time was this journal; prior implementation notes describe content already present in the starting commit.
- Confirmed the public verification seams: CLI JSON/exit behavior and `${CODEX_HOME}` filesystem postconditions. The implementation will follow vertical RED → GREEN slices at those seams.
- Accepted runtime boundary: the skill cannot inspect or refresh the current spawn schema, reload custom-agent profiles, or restart Codex. Session spawn capabilities must be supplied by the parent/tool schema.
- Planned changed areas: router CLI and tests/fixtures first; then installer, skill/policy, README files, and generated-agent documentation as required. No global installation will be modified.

## Next step

Inspect the existing CLI and installer contracts, then add the first failing public-boundary test for spawn-capability resolution.

## Milestone: spawn-schema resolution contract

- RED proved the CLI rejected `--spawn-capabilities`; GREEN now validates the supplied per-model effort list and returns `ready_override` with non-null `model` and `reasoning_effort` only for an exact supported pair.
- RED proved an incompatible schema still returned `catalog_unverified`; GREEN now returns `restart_required` with null overrides, a state fingerprint, a `sync-agents` command, and explicit fresh-task/restart guidance when generated profiles are absent or stale.
- Corrupt/unreadable profile state is reserved for visible `blocked`; catalog-unresolved routes remain `unavailable`. Inherited execution is no longer modeled as a successful resolution.

## Next step

Add the `sync-agents` filesystem transaction and prove generated profiles, state fingerprinting, preservation of unrelated agents, and subsequent `ready_profile` resolution through the CLI.

## Milestone: generated-profile synchronization

- RED proved `sync-agents` was not a command; GREEN now validates the complete four-tier plan before writing, renders all profiles from stable templates, stages every profile plus the state file, backs up replaced files, atomically replaces individual files with the state marker last, and rolls back on installation failure.
- The persisted SHA-256 fingerprint covers the normalized four-tier route map plus sanitized catalog/provider identity. It stores no credentials. Matching state and exact profile fields yield `ready_profile`; missing/stale files yield `restart_required`; corrupt state or duplicate profile settings yield `blocked`.
- Focused filesystem tests prove all four generated mappings, backup creation, unrelated-agent preservation, no mutation on discovery failure, exact-effort matching, and a subsequent `ready_profile` route.
- RED proved the package installer overwrote generated profiles; GREEN now preserves existing profiles, seeds only missing ones, and installs canonical templates beside the skill for future synchronization.

## Next step

Update the skill, policy, READMEs, and installer guidance to the executable-state contract; then refactor/review the implementation and run full verification.

## Milestone: robust selector verified

- Updated the Skill, routing policy, English and Chinese READMEs, stable agent-template comments, and installed routing block to use only `ready_override` or fingerprint-matched `ready_profile` as executable success states. User-explicit model/effort choices retain precedence.
- Final verification passed: `npm test` (18/18), TypeScript syntax check, route self-test (9/9), Skill validator, plugin validator, and `git diff --check`.
- No global `~/.codex` or `~/.agents` installation was changed. Repository changes remain uncommitted as requested.

## Remaining runtime limitation

- The skill cannot introspect or refresh the current `spawn_agent` schema, reload custom-agent TOMLs, or restart Codex. The parent must construct `--spawn-capabilities` from its tool schema. After `sync-agents`, it must stop and require a fresh task/client restart before using the generated profiles; the script cannot independently prove that reload occurred.

## Next step

Parent review and, only after acceptance, run the repository installer/synchronizer in the intended global environment and start a fresh Codex task.

## Milestone: stale-session proof gap closed

- Parent review identified that matching disk profiles could incorrectly produce `ready_profile` immediately after synchronization while the running Codex session still had cached pre-sync agent definitions.
- RED tests proved generated descriptions lacked an observable marker, the CLI lacked loaded-session fingerprint input, and same-session post-sync routing returned false success.
- GREEN now appends `[codex-auto-router:<sha256>]` to every generated agent description while preserving its human text. Route and escalation accept a validated `--loaded-profile-fingerprint` derived from the one common marker exposed by all four loaded agent descriptions.
- Disk state/profile validation without that exact loaded-session fingerprint remains `restart_required`; a stale valid fingerprint also remains `restart_required`, and malformed input is rejected.
- Skill, policy, both READMEs, installer routing rules, CLI help, and restart guidance now require the parent to inspect the live spawn schema after restart and pass the common marker on every route/escalation.

## Next step

Run focused and full verification again, then return the updated evidence to the parent. Global installation remains out of scope.

## Milestone: stale-session fix verified

- Focused RED/GREEN coverage passed for description markers, same-session `restart_required`, fresh-session `ready_profile`, stale fingerprint rejection, and malformed fingerprint rejection.
- Final verification passed: `npm test` (21/21), TypeScript syntax check, route self-test (9/9), Skill validator, plugin validator, and `git diff --check`.
- No global installation, commit, push, or release was performed.

## Remaining runtime boundary

- The CLI can validate the supplied loaded fingerprint but cannot independently inspect the spawn schema. The parent must verify that all four loaded descriptions expose exactly one common marker before supplying it.

## Milestone: parent review found stale-session proof gap

- Filesystem profile/state matching alone cannot prove the current Codex session reloaded the generated TOMLs. Immediately after `sync-agents`, the same stale session could call `route` again and receive `ready_profile` even though its cached agent definitions still use the old settings.
- Required correction: generated profiles expose the route fingerprint through the agent description loaded into the spawn schema. The parent must pass that loaded fingerprint back to the router; `ready_profile` is allowed only when the supplied loaded fingerprint matches the active profile/state fingerprint. Missing or stale evidence remains `restart_required`.

## Next step

Add a failing stale-session test, implement loaded-profile fingerprint verification, then run quality review and the complete verification suite.

## Milestone: parent review found missing session-plan intersection

- The first implementation verifies only whether the catalog-selected candidate is accepted by the spawn schema. With the current DeepSeek-only fallback catalog and GPT-capable session, it still returns `restart_required` instead of selecting an executable GPT route.
- Required correction: when validated spawn capabilities are supplied, construct the executable four-tier plan from those capabilities (using catalog metadata only for exact matching/enrichment). The current spawn schema is authoritative for in-session execution. Profile synchronization remains the path when no session-compatible explicit route exists.
- This distinction prevents a stale/unbound local catalog from forcing installation of models the current session cannot spawn, while provider changes still become visible after a fresh session updates its tool schema.

## Next step

Quality-fixer adds a cross-family mismatch test, implements session-authoritative route selection, reruns all checks, and reviews the complete write set before global installation.

## Milestone: quality approved and global installation updated

- Quality-fixer approved the complete write set after adding the cross-family session-authoritative route. The current GPT spawn schema now yields four `ready_override` routes even when the fallback catalog contains only DeepSeek models; the catalog candidates remain diagnostic.
- Parent verification passed `npm test` (23/23), the route self-test, TypeScript syntax check, installer shell syntax, Skill validation, plugin validation, and `git diff --check`.
- Ran `scripts/install.sh`. The updated Skill, agent templates, and canonical global AGENTS routing block are installed. Existing global agent profiles were preserved by design; no profile synchronization or restart is required while explicit session overrides provide a complete executable plan.

## Next step

Compare installed artifacts with the repository, run the installed CLI with this session's real spawn capabilities, and perform one explicit-override subagent smoke test before final handoff.

## Milestone: installed end-to-end verification complete

- Installed `SKILL.md`, `route.ts`, and `routing-policy.md` hashes exactly match the repository copies; all four canonical agent templates are present under the installed Skill.
- The globally installed CLI used this session's actual spawn capability set and returned `QUICK -> gpt-6-luna / high`, `ready_override`, despite the diagnostic fallback catalog remaining DeepSeek-only.
- Successfully spawned the installed `quick` custom agent with the returned explicit `gpt-6-luna / high` override; the agent completed with `override-spawn-ok`.
- No generated profile synchronization was needed, so the current session remains valid and no restart is required for the explicit-override path.

## Final state

- Repository implementation and tests are complete but uncommitted.
- Global Skill and routing instructions are updated and verified.
- Future sessions must continue supplying their current spawn capability schema. Profile synchronization remains a guarded fallback for sessions that cannot form a complete explicit route.

## Milestone: final quality repair started

- Quality scope is the supplied 13-file task write set relative to `d247aa4bf97a5c41a6d8d3ebeb29772fa5714a93`; the working tree contains only those existing uncommitted changes at start.
- Confirmed required outcome: validated current-session spawn capabilities are the executable source of truth and must produce a complete four-tier explicit plan even when the catalog is stale or from a disjoint model family. Catalog candidate/source remain diagnostic metadata.
- Planned sequence: add and run a public CLI regression test (RED), repair plan construction and run the focused test (GREEN), update user-facing authority/fallback documentation, then run focused/full tests, self-test, validators, syntax/type checks, security/input review, installer transaction review, and `git diff --check`.
- No global `~/.codex` or `~/.agents` paths, commits, pushes, or releases are authorized.

## Next step

Inspect the route plan/scoring pipeline and existing public CLI fixtures, then add the cross-family RED test before production-code changes.

## Milestone: session-authoritative quality repair verified

- RED: the public `routes` CLI returned `resolved: false` for GPT-capable spawn metadata paired with a DeepSeek-only catalog. GREEN: validated spawn capabilities now feed the existing model scoring and effort selection to create the executable four-tier plan; the original catalog candidate/source remain diagnostic.
- A complete session plan yields exact `ready_override` model/effort pairs. Empty/incomplete session capabilities use the fingerprinted catalog-profile path, so no partial or inherited success state was introduced. Disk profile matching still cannot produce `ready_profile` without the exact loaded-session fingerprint.
- Input review found and fixed one adjacent boundary gap: spawn capability model identifiers now use the same restricted grammar as catalog IDs, with a public CLI RED/GREEN test rejecting control-character injection.
- Documentation and installer rules now state that the current spawn schema is authoritative for explicit in-session overrides and profile synchronization is only for routes unavailable through those overrides.
- Verification passed: focused cross-family RED/GREEN; dynamic routing tests (18/18); full `npm test` (23/23); router self-test (9/9); TypeScript strip/check; `bash -n`; Skill validator; plugin validator; and `git diff --check`.
- Reviewed parsing, exact effort selection, fingerprint/state validation, stale-session proof, staged profile installation/backup/rollback path, installer preservation of generated profiles, secret handling, and all resolution states. No inherited-success path or credential material was found in the diff.
- No global installation, commit, push, or release was performed.

## Remaining runtime boundary

- The CLI still relies on the parent to transcribe the live spawn schema accurately. It cannot introspect or refresh that schema, reload generated profiles, or independently prove a client restart; the common loaded-profile fingerprint remains the required proof for `ready_profile`.

## Next step

Parent performs final acceptance. Global installation or synchronization remains a separate explicitly authorized operation.

## Resume: GPT 6.1 Sol release (2026-10-01)

- Goal: prefer the newly executable GPT 6.1 Sol for STANDARD/DEEP and Sol fallback, preserve Luna QUICK and Astra ARCHITECT, verify and push a versioned release, then deploy the global skill.
- Reconciled prior thread, filesystem and git: actual source remains in this repository; `/Users/yangjin/AITools/codex-auto-router` is empty. Branch main at d247aa4, with 13 existing modified files from the accepted capability/profile implementation. Preserve and release those changes with this update.
- Starting manifest version: 0.2.2. Current tool capabilities include gpt-6.1-sol with low through ultra; loaded tier descriptions have no common fingerprint. Installed router currently selects deep/gpt-6-sol/high, ready_override.
- Plan: delegate bounded scoring/docs/regression implementation to deep; parent verifies inherited work, prepares version 0.3.0 for the capability-state feature release, commits and pushes main/tag, creates release if supported, installs and verifies global artifacts.
- Affected paths: scoring/router tests, routing docs, package/plugin versions, release notes and this journal; deployment affects installed skill and canonical global routing rules through the existing backup-capable installer.
- User explicitly authorized push and deployment in the resumed request; prior no-push notes describe earlier scope and are superseded.

## Milestone: release preparation

- GitHub main still points to d247aa4; authenticated release/push tooling is available. Latest published version is v0.2.2.
- Selected v0.3.0 because this release includes the previously uncommitted CLI execution-state and profile synchronization features as well as GPT 6.1 Sol preference.
- Package and plugin manifests now share 0.3.0; release notes are in docs/RELEASE-v0.3.0.md.
- Parent reviewed the prior capability-selection, fingerprint validation and staged installation paths. Existing safeguards and provider fallbacks are preserved.
- Next: accept delegated change, run full tests/syntax checks, then commit/push/tag, publish release and deploy via installer.

## Milestone: GPT 6.1 Sol routing change verified

- Added explicit `gpt-6.1-sol` scoring for STANDARD, DEEP and ARCHITECT fallback. QUICK still selects Luna, and ARCHITECT still selects Astra when available.
- Public CLI RED tests reproduced the old `gpt-6-sol` selection in catalog and disjoint-session routes; GREEN now selects GPT 6.1 Sol at medium/high, and xhigh for the no-Astra fallback. Existing GPT-6 and GPT-5.6 catalog tests remain green.
- Updated routing policy and both READMEs. `node --test tests/route-dynamic.test.mjs` passed 21/21; `git diff --check` passed.
- Parent next runs the full release verification and installed current-session acceptance before commit, push and deployment.

## Milestone: GPT 6.1 Sol acceptance

- Delegated change adds explicit 6.1 Sol weights and three public CLI regression cases, with new catalog fixtures. STANDARD/DEEP select 6.1 Sol medium/high, Astra remains preferred and missing-Astra fallback selects 6.1 Sol/xhigh. Old GPT-6 and GPT-5.6 behavior remains tested.
- Parent verification: npm test 26/26; git diff --check; router TypeScript syntax; installer shell syntax; skill validator; package/plugin 0.3.0 match. Existing router self-test passed 9/9.
- Actual current spawn capability plan returns ready_override for all four tiers even with the disjoint current catalog: Luna/high, 6.1 Sol/medium, 6.1 Sol/high, Astra/high.
- Next deployment action: run scripts/install.sh (backs up current global files and preserves existing profiles), compare installed skill/templates to source and recheck installed routing. Actual 6.1 Sol/high subagent smoke test is running. Then commit release, push main/v0.3.0 and create GitHub Release.

## Milestone: local deployment verified

- scripts/install.sh completed with backups; installed tracked skill files and four canonical templates match source bytes. Existing global profiles are preserved.
- Installed CLI returns ready_override with Luna/high, 6.1 Sol/medium, 6.1 Sol/high and Astra/high using this session's actual capability set. Explicit overrides work without profile synchronization or a client restart.
- Successfully spawned a DEEP agent with explicit gpt-6.1-sol/high; it returned sol61-override-spawn-ok and confirmed scoring/Astra priority by read-only inspection.
- Next: commit verified 0.3.0 release changes, push main and annotated v0.3.0 tag, publish GitHub Release, inspect remote release/CI. The journal will record the resulting publication state after these actions.
