import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
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
    Object.entries(payload.routes).map(([tier, route]) => [tier, [route.model, route.reasoning_effort]]),
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


test("prefers GPT-6 when the catalog mixes GPT and DeepSeek models", () => {
  const payload = runRoutes(["--catalog", path.join(fixtures, "mixed-catalog.json"), "--no-live-models"]);
  assert.deepEqual(compactRoutes(payload), {
    quick: ["gpt-6-luna", "high"],
    standard: ["gpt-6-sol", "medium"],
    deep: ["gpt-6-sol", "high"],
    architect: ["gpt-6-astra", "high"],
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
