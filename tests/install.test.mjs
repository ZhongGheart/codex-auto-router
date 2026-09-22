import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("installer installs the skill, agents, and routing block idempotently", async (t) => {
  const home = await mkdtemp(path.join(tmpdir(), "codex-auto-router-"));
  t.after(() => rm(home, { recursive: true, force: true }));

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    AGENTS_HOME: path.join(home, ".agents"),
  };

  execFileSync("bash", [path.join(root, "scripts", "install.sh")], { env });
  execFileSync("bash", [path.join(root, "scripts", "install.sh")], { env });

  const skillPath = path.join(home, ".agents", "skills", "codex-auto-router", "SKILL.md");
  const routePath = path.join(home, ".agents", "skills", "codex-auto-router", "scripts", "route.ts");
  assert.equal(existsSync(skillPath), true);
  assert.equal(existsSync(routePath), true);

  for (const name of ["quick", "standard", "deep", "architect"]) {
    assert.equal(existsSync(path.join(home, ".codex", "agents", `${name}.toml`)), true);
  }

  const agentsMd = await readFile(path.join(home, ".codex", "AGENTS.md"), "utf8");
  assert.equal((agentsMd.match(/# BEGIN codex-auto-router/g) ?? []).length, 1);
  assert.equal((agentsMd.match(/# END codex-auto-router/g) ?? []).length, 1);
});
