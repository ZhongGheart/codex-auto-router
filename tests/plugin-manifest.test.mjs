import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8"));

test("plugin manifest contains the required distribution metadata", () => {
  assert.equal(manifest.name, "codex-auto-router");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.license, "MIT");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.author.name, "ZhongGheart");
  assert.ok(manifest.interface.displayName);
  assert.ok(manifest.interface.shortDescription);
  assert.ok(manifest.interface.longDescription);
  assert.ok(manifest.interface.developerName);
  assert.ok(manifest.interface.category);
  assert.ok(Array.isArray(manifest.interface.capabilities));
  assert.ok(Array.isArray(manifest.interface.defaultPrompt));
  assert.equal(manifest.interface.defaultPrompt.length, 3);
});

test("distribution files are present", () => {
  const files = [
    "skills/codex-auto-router/SKILL.md",
    "skills/codex-auto-router/scripts/route.ts",
    "skills/codex-auto-router/references/routing-policy.md",
    "agents/quick.toml",
    "agents/standard.toml",
    "agents/deep.toml",
    "agents/architect.toml",
    "scripts/install.sh",
    "LICENSE",
    "README.md",
    "README.zh-CN.md",
  ];
  for (const file of files) assert.equal(existsSync(path.join(root, file)), true, file);
});
