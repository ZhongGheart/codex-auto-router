import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routeScript = path.join(root, "skills", "codex-auto-router", "scripts", "route.ts");
const fixtures = path.join(root, "tests", "fixtures");
const execFileAsync = promisify(execFile);

function runRoutes(args) {
  const output = execFileSync(
    process.execPath,
    ["--experimental-strip-types", routeScript, "routes", ...args, "--pretty"],
    { encoding: "utf8" },
  );
  return JSON.parse(output);
}

function runRoute(args, options = {}) {
  const output = execFileSync(
    process.execPath,
    ["--experimental-strip-types", routeScript, "route", ...args, "--pretty"],
    { encoding: "utf8", ...options },
  );
  return JSON.parse(output);
}

function runCommand(command, args, options = {}) {
  const output = execFileSync(
    process.execPath,
    ["--experimental-strip-types", routeScript, command, ...args, "--pretty"],
    { encoding: "utf8", ...options },
  );
  return JSON.parse(output);
}

async function runRoutesAsync(args) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--experimental-strip-types", routeScript, "routes", ...args, "--pretty"],
    { encoding: "utf8" },
  );
  return JSON.parse(stdout);
}

function compactRoutes(payload) {
  return Object.fromEntries(
    Object.entries(payload.routes).map(([tier, route]) => [tier, [route.catalog_candidate?.model, route.catalog_candidate?.reasoning_effort]]),
  );
}

test("adapts to the DeepSeek catalog", () => {
  const payload = runRoutes(["--catalog", path.join(fixtures, "deepseek-catalog.json"), "--no-live-models"]);
  assert.deepEqual(compactRoutes(payload), {
    quick: ["deepseek-flash", "low"],
    standard: ["deepseek-flash", "high"],
    deep: ["deepseek-flash", "max"],
    architect: ["deepseek-v4-pro", "max"],
  });
});

test("returns executable overrides when the selected model and effort are supported by the spawn schema", () => {
  const capabilities = JSON.stringify({
    models: [
      { model: "gpt-6-luna", reasoning_efforts: ["low", "medium", "high"] },
      { model: "gpt-6-sol", reasoning_efforts: ["low", "medium", "high"] },
      { model: "gpt-6-astra", reasoning_efforts: ["low", "medium", "high"] },
    ],
  });
  const payload = runRoute([
    "--task",
    "find the authentication middleware",
    "--catalog",
    path.join(fixtures, "gpt-catalog.json"),
    "--no-live-models",
    "--spawn-capabilities",
    capabilities,
  ]);

  assert.equal(payload.model_resolution, "ready_override");
  assert.equal(payload.model, "gpt-6-luna");
  assert.equal(payload.reasoning_effort, "high");
  assert.equal(payload.model_provider, "spawn_override");
});

test("uses the current spawn schema as executable truth when the catalog is from another model family", () => {
  const capabilities = JSON.stringify({
    models: [
      { model: "gpt-6-luna", reasoning_efforts: ["low", "medium", "high"] },
      { model: "gpt-6-sol", reasoning_efforts: ["low", "medium", "high"] },
      { model: "gpt-6-astra", reasoning_efforts: ["low", "medium", "high"] },
    ],
  });
  const payload = runRoutes([
    "--catalog",
    path.join(fixtures, "deepseek-catalog.json"),
    "--no-live-models",
    "--spawn-capabilities",
    capabilities,
  ]);

  assert.equal(payload.resolved, true);
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(payload.routes).map(([tier, route]) => [
        tier,
        [route.model, route.reasoning_effort, route.model_resolution, route.model_provider],
      ]),
    ),
    {
      quick: ["gpt-6-luna", "high", "ready_override", "spawn_override"],
      standard: ["gpt-6-sol", "medium", "ready_override", "spawn_override"],
      deep: ["gpt-6-sol", "high", "ready_override", "spawn_override"],
      architect: ["gpt-6-astra", "high", "ready_override", "spawn_override"],
    },
  );
  assert.deepEqual(compactRoutes(payload), {
    quick: ["deepseek-flash", "low"],
    standard: ["deepseek-flash", "high"],
    deep: ["deepseek-flash", "max"],
    architect: ["deepseek-v4-pro", "max"],
  });
  assert.match(payload.model_catalog_source, /deepseek-catalog\.json$/);
});

test("requires profile synchronization and a fresh restart when the spawn schema cannot produce a complete plan", async (t) => {
  const codexHome = await mkdtemp(path.join(tmpdir(), "codex-auto-router-profile-missing-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const capabilities = JSON.stringify({ models: [] });
  const payload = runRoute(
    [
      "--task",
      "find the authentication middleware",
      "--catalog",
      path.join(fixtures, "gpt-catalog.json"),
      "--no-live-models",
      "--spawn-capabilities",
      capabilities,
    ],
    { env: { ...process.env, CODEX_HOME: codexHome } },
  );

  assert.equal(payload.model_resolution, "restart_required");
  assert.equal(payload.model, null);
  assert.equal(payload.reasoning_effort, null);
  assert.match(payload.sync_command, /sync-agents/);
  assert.match(payload.next_step, /fresh Codex task|restart/i);
});

test("synchronizes all generated profiles but keeps the same stale session restart-required", async (t) => {
  const codexHome = await mkdtemp(path.join(tmpdir(), "codex-auto-router-sync-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const agentsDir = path.join(codexHome, "agents");
  await mkdir(agentsDir, { recursive: true });
  await writeFile(path.join(agentsDir, "unrelated.toml"), 'name = "unrelated"\n');
  await writeFile(path.join(agentsDir, "quick.toml"), 'name = "quick"\n# previous working profile\n');
  const env = { ...process.env, CODEX_HOME: codexHome };
  const catalog = path.join(fixtures, "deepseek-catalog.json");

  const sync = runCommand("sync-agents", ["--catalog", catalog, "--no-live-models"], { env });
  assert.equal(sync.action, "sync-agents");
  assert.equal(sync.model_resolution, "restart_required");
  assert.equal(sync.updated_profiles.length, 4);
  assert.match(sync.next_step, /fresh Codex task|restart/i);

  const expected = {
    quick: ["deepseek-flash", "low"],
    standard: ["deepseek-flash", "high"],
    deep: ["deepseek-flash", "max"],
    architect: ["deepseek-v4-pro", "max"],
  };
  for (const [tier, [model, effort]] of Object.entries(expected)) {
    const profile = await readFile(path.join(agentsDir, `${tier}.toml`), "utf8");
    assert.match(profile, new RegExp(`^model = "${model}"$`, "m"));
    assert.match(profile, new RegExp(`^model_reasoning_effort = "${effort}"$`, "m"));
    assert.match(profile, new RegExp(`^description = ".*\\[codex-auto-router:${sync.fingerprint}\\].*"$`, "m"));
  }
  assert.equal(await readFile(path.join(agentsDir, "unrelated.toml"), "utf8"), 'name = "unrelated"\n');
  const state = JSON.parse(await readFile(path.join(codexHome, "codex-auto-router-state.json"), "utf8"));
  assert.equal(state.fingerprint, sync.fingerprint);
  assert.deepEqual(state.routes.quick, {
    agent: "quick",
    model: "deepseek-flash",
    reasoning_effort: "low",
  });
  const backupEntries = await readdir(path.join(codexHome, "backups"), { recursive: true });
  assert.equal(backupEntries.some((entry) => entry.endsWith("quick.toml")), true);

  const capabilities = JSON.stringify({ models: [] });
  const routed = runRoute(
    [
      "--task",
      "find the authentication middleware",
      "--catalog",
      catalog,
      "--no-live-models",
      "--spawn-capabilities",
      capabilities,
    ],
    { env },
  );
  assert.equal(routed.model_resolution, "restart_required");
  assert.match(routed.resolution_reason, /loaded profile fingerprint/i);
  assert.equal(routed.model, null);
  assert.equal(routed.reasoning_effort, null);
});

test("resolves through profiles only when a fresh session supplies the loaded common fingerprint", async (t) => {
  const codexHome = await mkdtemp(path.join(tmpdir(), "codex-auto-router-fresh-profile-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const env = { ...process.env, CODEX_HOME: codexHome };
  const catalog = path.join(fixtures, "deepseek-catalog.json");
  const sync = runCommand("sync-agents", ["--catalog", catalog, "--no-live-models"], { env });

  const routed = runRoute(
    [
      "--task",
      "find the authentication middleware",
      "--catalog",
      catalog,
      "--no-live-models",
      "--loaded-profile-fingerprint",
      sync.fingerprint,
    ],
    { env },
  );

  assert.equal(routed.model_resolution, "ready_profile");
  assert.equal(routed.model_provider, "agent_profile");
  assert.equal(routed.fingerprint, sync.fingerprint);
});

test("keeps a stale loaded profile fingerprint restart-required", async (t) => {
  const codexHome = await mkdtemp(path.join(tmpdir(), "codex-auto-router-stale-loaded-profile-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const env = { ...process.env, CODEX_HOME: codexHome };
  const catalog = path.join(fixtures, "deepseek-catalog.json");
  const sync = runCommand("sync-agents", ["--catalog", catalog, "--no-live-models"], { env });
  const staleFingerprint = sync.fingerprint.replace(/^./, sync.fingerprint[0] === "0" ? "1" : "0");

  const routed = runRoute(
    [
      "--task",
      "find the authentication middleware",
      "--catalog",
      catalog,
      "--no-live-models",
      "--loaded-profile-fingerprint",
      staleFingerprint,
    ],
    { env },
  );

  assert.equal(routed.model_resolution, "restart_required");
  assert.match(routed.resolution_reason, /does not match/i);
});

test("rejects an invalid loaded profile fingerprint visibly", () => {
  assert.throws(
    () =>
      runRoute([
        "--task",
        "find the authentication middleware",
        "--catalog",
        path.join(fixtures, "gpt-catalog.json"),
        "--no-live-models",
        "--loaded-profile-fingerprint",
        "not-a-sha256",
      ]),
    /--loaded-profile-fingerprint must be a 64-character lowercase SHA-256 fingerprint/,
  );
});

test("rejects malformed spawn capability model identifiers", () => {
  const capabilities = JSON.stringify({
    models: [{ model: "gpt-6-sol\nmodel = injected", reasoning_efforts: ["high"] }],
  });
  assert.throws(
    () =>
      runRoute([
        "--task",
        "find the authentication middleware",
        "--catalog",
        path.join(fixtures, "gpt-catalog.json"),
        "--no-live-models",
        "--spawn-capabilities",
        capabilities,
      ]),
    /Invalid spawn capability model identifier/,
  );
});

test("does not modify an existing installation when catalog discovery fails", async (t) => {
  const codexHome = await mkdtemp(path.join(tmpdir(), "codex-auto-router-sync-failure-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const agentsDir = path.join(codexHome, "agents");
  await mkdir(agentsDir, { recursive: true });
  const previous = 'name = "quick"\nmodel = "known-good"\nmodel_reasoning_effort = "high"\n';
  await writeFile(path.join(agentsDir, "quick.toml"), previous);

  const result = runCommand(
    "sync-agents",
    ["--catalog", path.join(codexHome, "missing-catalog.json"), "--no-live-models"],
    { env: { ...process.env, CODEX_HOME: codexHome } },
  );

  assert.equal(result.model_resolution, "unavailable");
  assert.equal(await readFile(path.join(agentsDir, "quick.toml"), "utf8"), previous);
  assert.deepEqual(await readdir(agentsDir), ["quick.toml"]);
});

test("reports corrupt generated-profile state as blocked instead of inheriting", async (t) => {
  const codexHome = await mkdtemp(path.join(tmpdir(), "codex-auto-router-state-corrupt-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  await writeFile(path.join(codexHome, "codex-auto-router-state.json"), "not json\n");

  const payload = runRoute(
    [
      "--task",
      "find the authentication middleware",
      "--catalog",
      path.join(fixtures, "gpt-catalog.json"),
      "--no-live-models",
    ],
    { env: { ...process.env, CODEX_HOME: codexHome } },
  );

  assert.equal(payload.model_resolution, "blocked");
  assert.equal(payload.model_provider, null);
  assert.match(payload.resolution_reason, /not valid JSON/);
});

test("selects an exact supported session effort instead of inventing the catalog preference", async (t) => {
  const codexHome = await mkdtemp(path.join(tmpdir(), "codex-auto-router-effort-mismatch-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const capabilities = JSON.stringify({
    models: [{ model: "gpt-6-luna", reasoning_efforts: ["low", "medium"] }],
  });
  const payload = runRoute(
    [
      "--task",
      "find the authentication middleware",
      "--catalog",
      path.join(fixtures, "gpt-catalog.json"),
      "--no-live-models",
      "--spawn-capabilities",
      capabilities,
    ],
    { env: { ...process.env, CODEX_HOME: codexHome } },
  );

  assert.equal(payload.catalog_candidate.reasoning_effort, "high");
  assert.equal(payload.model_resolution, "ready_override");
  assert.equal(payload.model, "gpt-6-luna");
  assert.equal(payload.reasoning_effort, "medium");
});

test("marks a catalog route unavailable when the catalog declares no supported reasoning effort", async (t) => {
  const codexHome = await mkdtemp(path.join(tmpdir(), "codex-auto-router-no-effort-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const catalog = path.join(codexHome, "catalog.json");
  await writeFile(catalog, JSON.stringify({ models: [{ slug: "single-model", display_name: "Single Model" }] }));

  const payload = runRoute(
    ["--task", "find the authentication middleware", "--catalog", catalog, "--no-live-models"],
    { env: { ...process.env, CODEX_HOME: codexHome } },
  );

  assert.equal(payload.model_resolution, "unavailable");
  assert.equal(payload.model, null);
  assert.equal(payload.reasoning_effort, null);
});


test("prefers GPT-6 when the catalog mixes GPT and DeepSeek models", () => {
  const payload = runRoutes(["--catalog", path.join(fixtures, "mixed-catalog.json"), "--no-live-models"]);
  assert.deepEqual(compactRoutes(payload), {
    quick: ["gpt-6-luna", "high"],
    standard: ["gpt-6-sol", "medium"],
    deep: ["gpt-6-sol", "high"],
    architect: ["gpt-6-astra", "high"],
  });
});

test("prefers GPT-6.1 Sol for standard and deep in a catalog with GPT-6 Sol", () => {
  const payload = runRoutes(["--catalog", path.join(fixtures, "gpt-6.1-catalog.json"), "--no-live-models"]);
  assert.deepEqual(compactRoutes(payload), {
    quick: ["gpt-6-luna", "high"],
    standard: ["gpt-6.1-sol", "medium"],
    deep: ["gpt-6.1-sol", "high"],
    architect: ["gpt-6-astra", "high"],
  });
});

test("prefers GPT-6.1 Sol from the current spawn schema even with a disjoint catalog", () => {
  const capabilities = JSON.stringify({
    models: [
      { model: "gpt-6-luna", reasoning_efforts: ["low", "medium", "high"] },
      { model: "gpt-6-sol", reasoning_efforts: ["low", "medium", "high", "xhigh"] },
      { model: "gpt-6.1-sol", reasoning_efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] },
      { model: "gpt-6-astra", reasoning_efforts: ["low", "medium", "high"] },
    ],
  });
  const payload = runRoutes([
    "--catalog", path.join(fixtures, "deepseek-catalog.json"), "--no-live-models",
    "--spawn-capabilities", capabilities,
  ]);
  assert.equal(payload.resolved, true);
  assert.deepEqual(
    Object.fromEntries(Object.entries(payload.routes).map(([tier, route]) => [
      tier, [route.model, route.reasoning_effort, route.model_resolution],
    ])),
    {
      quick: ["gpt-6-luna", "high", "ready_override"],
      standard: ["gpt-6.1-sol", "medium", "ready_override"],
      deep: ["gpt-6.1-sol", "high", "ready_override"],
      architect: ["gpt-6-astra", "high", "ready_override"],
    },
  );
  assert.deepEqual(compactRoutes(payload), {
    quick: ["deepseek-flash", "low"],
    standard: ["deepseek-flash", "high"],
    deep: ["deepseek-flash", "max"],
    architect: ["deepseek-v4-pro", "max"],
  });
});

test("uses GPT-6.1 Sol with stronger reasoning when Astra is unavailable", () => {
  const payload = runRoutes(["--catalog", path.join(fixtures, "gpt-6.1-no-astra-catalog.json"), "--no-live-models"]);
  assert.deepEqual(compactRoutes(payload), {
    quick: ["gpt-6-luna", "high"],
    standard: ["gpt-6.1-sol", "medium"],
    deep: ["gpt-6.1-sol", "high"],
    architect: ["gpt-6.1-sol", "xhigh"],
  });
});

test("adapts to the latest GPT-6 catalog", () => {
  const payload = runRoutes(["--catalog", path.join(fixtures, "gpt-catalog.json"), "--no-live-models"]);
  assert.deepEqual(compactRoutes(payload), {
    quick: ["gpt-6-luna", "high"],
    standard: ["gpt-6-sol", "medium"],
    deep: ["gpt-6-sol", "high"],
    architect: ["gpt-6-astra", "high"],
  });
});

test("raises architect reasoning when GPT-6 Astra is unavailable", () => {
  const payload = runRoutes(["--catalog", path.join(fixtures, "gpt-no-astra-catalog.json"), "--no-live-models"]);
  assert.deepEqual(compactRoutes(payload), {
    quick: ["gpt-6-luna", "high"],
    standard: ["gpt-6-sol", "medium"],
    deep: ["gpt-6-sol", "high"],
    architect: ["gpt-6-sol", "xhigh"],
  });
});

test("falls back to the GPT-5.6 family when GPT-6 is unavailable", () => {
  const payload = runRoutes(["--catalog", path.join(fixtures, "gpt-5.6-catalog.json"), "--no-live-models"]);
  assert.deepEqual(compactRoutes(payload), {
    quick: ["gpt-5.6-luna", "low"],
    standard: ["gpt-5.6-terra", "medium"],
    deep: ["gpt-5.6-sol", "high"],
    architect: ["gpt-5.6-sol", "xhigh"],
  });
});

test("resolves the GPT mapping from a live models endpoint", async (t) => {
  const catalog = readFileSync(path.join(fixtures, "gpt-catalog.json"));
  const server = createServer((request, response) => {
    if (request.url !== "/v1/models") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(catalog);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const payload = await runRoutesAsync(["--models-url", `http://127.0.0.1:${address.port}/v1/models`]);
  assert.equal(payload.model_catalog_source, `live:http://127.0.0.1:${address.port}/v1/models`);
  assert.deepEqual(compactRoutes(payload), {
    quick: ["gpt-6-luna", "high"],
    standard: ["gpt-6-sol", "medium"],
    deep: ["gpt-6-sol", "high"],
    architect: ["gpt-6-astra", "high"],
  });
});
