#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

type Tier = "quick" | "standard" | "deep" | "architect";
type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";

type RouteDefinition = {
  agent: string;
  model: string | null;
  reasoning_effort: Effort | null;
  label: "QUICK" | "STANDARD" | "DEEP" | "ARCHITECT";
  model_resolution: "dynamic" | "unavailable";
};

type SpawnRoute = {
  model: string | null;
  reasoning_effort: Effort | null;
  model_resolution: "ready_override" | "ready_profile" | "restart_required" | "blocked" | "unavailable";
  model_provider: "spawn_override" | "agent_profile" | null;
  catalog_candidate?: { model: string; reasoning_effort: Effort | null };
  fingerprint?: string;
  sync_command?: string;
  next_step?: string;
  resolution_reason?: string;
};

type SpawnCapabilities = Map<string, Set<Effort>>;

type RoutingPlan = {
  routes: Record<Tier, RouteDefinition>;
  source: string;
  available_models: string[];
  resolved: boolean;
  fallback_reason?: string;
};

type CatalogModel = {
  slug: string;
  display_name?: string;
  supported_reasoning_levels?: unknown[];
  default_reasoning_level?: unknown;
  priority?: number;
  visibility?: string;
  supported_in_api?: boolean;
};

type DeterministicResult = {
  tier: Tier;
  confidence: number;
  reasons: string[];
};

type Options = {
  command: string;
  task: string;
  context: string;
  stdin: boolean;
  pretty: boolean;
  noTypesafe: boolean;
  forceTypesafe: boolean;
  noLiveModels: boolean;
  catalogPath: string;
  modelsUrl: string;
  minConfidence: number;
  currentTier: string;
  reason: string;
  spawnCapabilities: string;
  loadedProfileFingerprint: string;
  positional: string[];
};

const TIERS: Tier[] = ["quick", "standard", "deep", "architect"];
const EFFORT_ORDER: Effort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]*$/;
const CODEX_HOME = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(homedir(), ".codex");

const TIER_META: Record<Tier, { agent: string; label: RouteDefinition["label"]; desiredEffort: Effort }> = {
  quick: { agent: "quick", label: "QUICK", desiredEffort: "low" },
  standard: { agent: "standard", label: "STANDARD", desiredEffort: "medium" },
  deep: { agent: "deep", label: "DEEP", desiredEffort: "high" },
  architect: { agent: "architect", label: "ARCHITECT", desiredEffort: "high" },
};

function preferredEffortForModel(tier: Tier, model: CatalogModel): Effort {
  if (tier === "quick" && model.slug.toLowerCase().includes("gpt-6-luna")) return "high";
  return TIER_META[tier].desiredEffort;
}

const MODEL_TOKEN_WEIGHTS: Record<Tier, Array<[string, number]>> = {
  quick: [
    ["gpt-6-luna", 180],
    ["gpt-5.6-luna", 150],
    ["luna", 120],
    ["flash", 100],
    ["mini", 90],
    ["haiku", 90],
    ["small", 60],
    ["terra", 20],
    ["sol", -20],
    ["pro", 5],
  ],
  standard: [
    ["gpt-6.1-sol", 240],
    ["gpt-6-sol", 200],
    ["gpt-5.6-terra", 160],
    ["gpt-5.6-sol", 120],
    ["terra", 100],
    ["sol", 80],
    ["pro", 80],
    ["medium", 70],
    ["flash", 25],
    ["luna", 5],
  ],
  deep: [
    ["gpt-6.1-sol", 240],
    ["gpt-6-sol", 200],
    ["gpt-5.6-sol", 160],
    ["sol", 120],
    ["pro", 80],
    ["terra", 45],
    ["astra", 10],
    ["flash", -20],
    ["luna", -60],
  ],
  architect: [
    ["gpt-6-astra", 220],
    ["astra", 150],
    ["gpt-6.1-sol", 180],
    ["gpt-6-sol", 150],
    ["gpt-5.6-sol", 120],
    ["sol", 100],
    ["pro", 80],
    ["terra", 25],
    ["flash", -50],
    ["luna", -90],
  ],
};

const QUICK_PATTERNS: RegExp[] = [
  /\b(find|search|locate|read|list|grep|rg|summarize|show me|format|rename|git diff)\b/i,
  /(^|\s)(查找|搜索|定位|读取|列出|查看|格式化|重命名|总结|运行明确测试)/,
];

const MUTATION_PATTERNS: RegExp[] = [
  /\b(delete|remove|modify|change|edit|update|replace|alter|disable|drop|strip|rewrite|implement|add|fix|refactor)\b/i,
  /(删除|移除|修改|更改|编辑|更新|替换|禁用|实现|新增|修复|重构)/,
];

const STANDARD_PATTERNS: RegExp[] = [
  /\b(implement|add|feature|fix|bug fix|refactor|test|api integration|backend|frontend|ui|database|schema|component|endpoint|page)\b/i,
  /(实现|新增|功能|修复|重构|测试|接口|后端|前端|数据库|组件|页面)/,
];

const DEEP_PATTERNS: RegExp[] = [
  /\b(root cause|debug|race condition|deadlock|concurrency|performance|security|vulnerab|migration|cross-module|intermittent|flaky|memory leak|data corruption|incident|regression)\b/i,
  /(根因|并发|死锁|竞态|性能|安全|漏洞|复杂迁移|跨模块|偶发|间歇|内存泄漏|数据损坏|线上\s*500|权限绕过)/,
];

const ARCHITECT_PATTERNS: RegExp[] = [
  /\b(architecture|architectural|redesign the system|redesign the platform|whole-system|cross-system|cross-service|platform-wide|irreversible migration|public contract decision)\b/i,
  /(系统架构|架构重构|跨系统|跨服务|平台级|整体重设计|不可逆迁移|公共契约决策|大规模架构决策)/,
];

function parseArgs(argv: string[]): Options {
  const options: Options = {
    command: "route",
    task: "",
    context: "",
    stdin: false,
    pretty: false,
    noTypesafe: false,
    forceTypesafe: false,
    noLiveModels: false,
    catalogPath: "",
    modelsUrl: "",
    minConfidence: 0.65,
    currentTier: "",
    reason: "",
    spawnCapabilities: "",
    loadedProfileFingerprint: "",
    positional: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--stdin") {
      options.stdin = true;
    } else if (argument === "--pretty") {
      options.pretty = true;
    } else if (argument === "--no-typesafe") {
      options.noTypesafe = true;
    } else if (argument === "--force-typesafe") {
      options.forceTypesafe = true;
    } else if (argument === "--no-live-models") {
      options.noLiveModels = true;
    } else if (argument === "--task") {
      options.task = argv[++index] ?? "";
    } else if (argument === "--context") {
      options.context = argv[++index] ?? "";
    } else if (argument === "--catalog") {
      options.catalogPath = argv[++index] ?? "";
    } else if (argument === "--models-url") {
      options.modelsUrl = argv[++index] ?? "";
    } else if (argument === "--min-confidence") {
      options.minConfidence = Number(argv[++index] ?? "0.65");
    } else if (argument === "--current") {
      options.currentTier = argv[++index] ?? "";
    } else if (argument === "--reason") {
      options.reason = argv[++index] ?? "";
    } else if (argument === "--spawn-capabilities") {
      options.spawnCapabilities = argv[++index] ?? "";
    } else if (argument === "--loaded-profile-fingerprint") {
      options.loadedProfileFingerprint = argv[++index] ?? "";
      if (!/^[a-f0-9]{64}$/.test(options.loadedProfileFingerprint)) {
        throw new Error("--loaded-profile-fingerprint must be a 64-character lowercase SHA-256 fingerprint.");
      }
    } else if (argument === "--help" || argument === "-h") {
      options.command = "help";
    } else if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    } else {
      options.positional.push(argument);
    }
  }

  const commands = new Set(["route", "escalate", "routes", "sync-agents", "selftest", "help"]);
  if (options.positional.length > 0 && commands.has(options.positional[0] ?? "")) {
    options.command = options.positional[0] ?? "route";
    options.positional = options.positional.slice(1);
  }
  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function readTask(options: Options): Promise<string> {
  if (options.task.trim()) return options.task.trim();
  if (options.positional.length > 0) return options.positional.join(" ").trim();
  if (options.stdin) {
    const value = await readStdin();
    if (value) return value;
  }
  throw new Error("No task supplied. Use --task, --stdin, or a positional task string.");
}

function matches(task: string, patterns: RegExp[]): string[] {
  return patterns.filter((pattern) => pattern.test(task)).map((pattern) => pattern.source);
}

function hasMixedQuickAndMutation(task: string): boolean {
  return matches(task, QUICK_PATTERNS).length > 0 && matches(task, MUTATION_PATTERNS).length > 0;
}

function classifyDeterministic(task: string): DeterministicResult | null {
  const normalized = task.replace(/\s+/g, " ").trim();
  if (!normalized) return null;

  const architectReasons = matches(normalized, ARCHITECT_PATTERNS);
  if (architectReasons.length > 0) {
    return { tier: "architect", confidence: 0.9, reasons: architectReasons };
  }

  const deepReasons = matches(normalized, DEEP_PATTERNS);
  if (deepReasons.length > 0) {
    return { tier: "deep", confidence: 0.86, reasons: deepReasons };
  }

  const quickReasons = matches(normalized, QUICK_PATTERNS);
  const standardReasons = matches(normalized, STANDARD_PATTERNS);
  const mutationReasons = matches(normalized, MUTATION_PATTERNS);
  if (quickReasons.length > 0 && standardReasons.length === 0 && mutationReasons.length === 0 && normalized.length <= 320) {
    return { tier: "quick", confidence: 0.94, reasons: quickReasons };
  }

  return null;
}

function classifyFallback(task: string): DeterministicResult {
  const normalized = task.replace(/\s+/g, " ").trim();
  const architectReasons = matches(normalized, ARCHITECT_PATTERNS);
  if (architectReasons.length > 0) return { tier: "architect", confidence: 0.7, reasons: architectReasons };

  const deepReasons = matches(normalized, DEEP_PATTERNS);
  if (deepReasons.length > 0) return { tier: "deep", confidence: 0.68, reasons: deepReasons };

  const quickReasons = matches(normalized, QUICK_PATTERNS);
  const standardReasons = matches(normalized, STANDARD_PATTERNS);
  const mutationReasons = matches(normalized, MUTATION_PATTERNS);
  if (quickReasons.length > 0 && standardReasons.length === 0 && mutationReasons.length === 0) {
    return { tier: "quick", confidence: 0.72, reasons: quickReasons };
  }

  return {
    tier: "standard",
    confidence: 0.55,
    reasons: ["No unambiguous deterministic route; conservative ambiguous-task fallback."],
  };
}

function normalizeTier(value: unknown): Tier | null {
  if (value === "critical") return "architect";
  return typeof value === "string" && TIERS.includes(value as Tier) ? (value as Tier) : null;
}

function nextTier(tier: Tier): Tier {
  const index = TIERS.indexOf(tier);
  return TIERS[Math.min(index + 1, TIERS.length - 1)] ?? "architect";
}

function normalizeEffort(value: unknown): Effort | null {
  return typeof value === "string" && EFFORT_ORDER.includes(value as Effort) ? (value as Effort) : null;
}

function parseSpawnCapabilities(value: string): SpawnCapabilities | null {
  if (!value) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("--spawn-capabilities must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { models?: unknown }).models)) {
    throw new Error('--spawn-capabilities must match {"models":[{"model":"...","reasoning_efforts":["..."]}]}');
  }

  const capabilities: SpawnCapabilities = new Map();
  for (const entry of (parsed as { models: unknown[] }).models) {
    if (!entry || typeof entry !== "object") throw new Error("Every spawn capability must be an object.");
    const record = entry as { model?: unknown; reasoning_efforts?: unknown };
    if (typeof record.model !== "string" || !record.model.trim() || !Array.isArray(record.reasoning_efforts)) {
      throw new Error("Every spawn capability needs a non-empty model and reasoning_efforts array.");
    }
    if (!MODEL_ID_PATTERN.test(record.model)) {
      throw new Error(`Invalid spawn capability model identifier: ${JSON.stringify(record.model)}`);
    }
    if (capabilities.has(record.model)) throw new Error(`Duplicate spawn capability model: ${record.model}`);
    const efforts = record.reasoning_efforts.map(normalizeEffort);
    if (efforts.length === 0 || efforts.some((effort) => effort === null)) {
      throw new Error(`Invalid or empty reasoning_efforts for spawn model: ${record.model}`);
    }
    capabilities.set(record.model, new Set(efforts as Effort[]));
  }
  return capabilities;
}

function normalizedRoutes(plan: RoutingPlan) {
  return Object.fromEntries(
    TIERS.map((tier) => {
      const route = plan.routes[tier];
      return [tier, { agent: route.agent, model: route.model, reasoning_effort: route.reasoning_effort }];
    }),
  );
}

function catalogIdentity(source: string): string {
  if (!source.startsWith("live:")) return source;
  try {
    const url = new URL(source.slice("live:".length));
    return `live:${url.origin}${url.pathname}`;
  } catch {
    return "live:invalid";
  }
}

function planFingerprint(plan: RoutingPlan): string {
  const content = JSON.stringify({ version: 1, catalog_identity: catalogIdentity(plan.source), routes: normalizedRoutes(plan) });
  return createHash("sha256").update(content).digest("hex");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function syncCommand(options: Options): string {
  const script = process.argv[1] ? path.resolve(process.argv[1]) : "route.ts";
  const args = ["node", "--experimental-strip-types", shellQuote(script), "sync-agents"];
  if (options.catalogPath) args.push("--catalog", shellQuote(path.resolve(options.catalogPath)), "--no-live-models");
  else if (options.modelsUrl) args.push("--models-url", shellQuote(catalogIdentity(`live:${options.modelsUrl}`).slice("live:".length)));
  return args.join(" ");
}

type ProfileResolution = Omit<SpawnRoute, "catalog_candidate">;

async function resolveProfileState(plan: RoutingPlan, options: Options): Promise<ProfileResolution> {
  const fingerprint = planFingerprint(plan);
  const restartRequired = (reason: string): ProfileResolution => ({
    model: null,
    reasoning_effort: null,
    model_resolution: "restart_required",
    model_provider: null,
    fingerprint,
    sync_command: syncCommand(options),
    next_step:
      "Run sync_command, then start a fresh Codex task or restart the client; extract the common fingerprint from all four loaded agent descriptions and pass it with --loaded-profile-fingerprint.",
    resolution_reason: reason,
  });
  const sessionRestartRequired = (reason: string): ProfileResolution => ({
    model: null,
    reasoning_effort: null,
    model_resolution: "restart_required",
    model_provider: null,
    fingerprint,
    next_step:
      "Start a fresh Codex task or restart the client, extract the one common profile fingerprint from all four loaded agent descriptions, and pass it with --loaded-profile-fingerprint.",
    resolution_reason: reason,
  });
  const statePath = path.join(CODEX_HOME, "codex-auto-router-state.json");
  let rawState: string;
  try {
    rawState = await readFile(statePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return restartRequired("Generated agent profile state is missing.");
    return {
      model: null,
      reasoning_effort: null,
      model_resolution: "blocked",
      model_provider: null,
      fingerprint,
      resolution_reason: `Could not read generated profile state: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let state: unknown;
  try {
    state = JSON.parse(rawState);
  } catch {
    return {
      model: null,
      reasoning_effort: null,
      model_resolution: "blocked",
      model_provider: null,
      fingerprint,
      resolution_reason: "Generated profile state is not valid JSON.",
    };
  }
  if (!state || typeof state !== "object" || typeof (state as { fingerprint?: unknown }).fingerprint !== "string") {
    return {
      model: null,
      reasoning_effort: null,
      model_resolution: "blocked",
      model_provider: null,
      fingerprint,
      resolution_reason: "Generated profile state does not match the supported state schema.",
    };
  }
  if ((state as { fingerprint: string }).fingerprint !== fingerprint) {
    return restartRequired("Generated agent profiles are stale for the active catalog mapping.");
  }
  const stateRecord = state as { version?: unknown; catalog_identity?: unknown; routes?: unknown };
  if (
    stateRecord.version !== 1 ||
    stateRecord.catalog_identity !== catalogIdentity(plan.source) ||
    JSON.stringify(stateRecord.routes) !== JSON.stringify(normalizedRoutes(plan))
  ) {
    return {
      model: null,
      reasoning_effort: null,
      model_resolution: "blocked",
      model_provider: null,
      fingerprint,
      resolution_reason: "Generated profile state content does not match its active fingerprint contract.",
    };
  }

  for (const tier of TIERS) {
    const expected = plan.routes[tier];
    const profilePath = path.join(CODEX_HOME, "agents", `${expected.agent}.toml`);
    let profile: string;
    try {
      profile = await readFile(profilePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return restartRequired(`Generated agent profile is missing: ${expected.agent}.toml`);
      return {
        model: null,
        reasoning_effort: null,
        model_resolution: "blocked",
        model_provider: null,
        fingerprint,
        resolution_reason: `Could not read generated agent profile ${expected.agent}.toml: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const models = [...profile.matchAll(/^model\s*=\s*"([^"]+)"\s*$/gm)].map((match) => match[1]);
    const efforts = [...profile.matchAll(/^model_reasoning_effort\s*=\s*"([^"]+)"\s*$/gm)].map((match) => match[1]);
    const fingerprints = [...profile.matchAll(/^# Generated by codex-auto-router; fingerprint: ([a-f0-9]{64})\s*$/gm)].map(
      (match) => match[1],
    );
    const descriptionFingerprints = [
      ...profile.matchAll(/^description\s*=\s*"[^"]*\[codex-auto-router:([a-f0-9]{64})\][^"]*"\s*$/gm),
    ].map((match) => match[1]);
    const names = [...profile.matchAll(/^name\s*=\s*"([^"]+)"\s*$/gm)].map((match) => match[1]);
    if (models.length === 0 || efforts.length === 0 || fingerprints.length === 0 || descriptionFingerprints.length === 0) {
      return restartRequired(`Generated agent profile is stale: ${expected.agent}.toml`);
    }
    if (
      models.length !== 1 ||
      efforts.length !== 1 ||
      fingerprints.length !== 1 ||
      descriptionFingerprints.length !== 1 ||
      names.length !== 1
    ) {
      return {
        model: null,
        reasoning_effort: null,
        model_resolution: "blocked",
        model_provider: null,
        fingerprint,
        resolution_reason: `Generated agent profile has ambiguous generated settings: ${expected.agent}.toml`,
      };
    }
    if (
      names[0] !== expected.agent ||
      models[0] !== expected.model ||
      efforts[0] !== expected.reasoning_effort ||
      fingerprints[0] !== fingerprint ||
      descriptionFingerprints[0] !== fingerprint
    ) {
      return restartRequired(`Generated agent profile is stale: ${expected.agent}.toml`);
    }
  }

  if (!options.loadedProfileFingerprint) {
    return sessionRestartRequired("The current session did not supply a loaded profile fingerprint from the spawn schema.");
  }
  if (options.loadedProfileFingerprint !== fingerprint) {
    return sessionRestartRequired("The loaded profile fingerprint does not match the active generated profiles.");
  }

  return {
    model: null,
    reasoning_effort: null,
    model_resolution: "ready_profile",
    model_provider: "agent_profile",
    fingerprint,
  };
}

function parseCatalogModel(value: unknown): CatalogModel | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const slug = typeof record.slug === "string" ? record.slug : typeof record.id === "string" ? record.id : "";
  if (!MODEL_ID_PATTERN.test(slug)) return null;
  return {
    slug,
    display_name: typeof record.display_name === "string" ? record.display_name : undefined,
    supported_reasoning_levels: Array.isArray(record.supported_reasoning_levels)
      ? record.supported_reasoning_levels
      : undefined,
    default_reasoning_level: record.default_reasoning_level,
    priority: typeof record.priority === "number" ? record.priority : undefined,
    visibility: typeof record.visibility === "string" ? record.visibility : undefined,
    supported_in_api: typeof record.supported_in_api === "boolean" ? record.supported_in_api : undefined,
  };
}

function parseCatalog(value: unknown): CatalogModel[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const raw = Array.isArray(record.models) ? record.models : Array.isArray(record.data) ? record.data : [];
  return raw
    .map(parseCatalogModel)
    .filter((model): model is CatalogModel => model !== null)
    .filter((model) => model.visibility !== "hidden" && model.supported_in_api !== false);
}

function supportedEfforts(model: CatalogModel): Effort[] {
  const efforts = (model.supported_reasoning_levels ?? [])
    .map((level) => {
      if (typeof level === "string") return normalizeEffort(level);
      if (level && typeof level === "object") return normalizeEffort((level as { effort?: unknown }).effort);
      return null;
    })
    .filter((effort): effort is Effort => effort !== null);
  return [...new Set(efforts)].sort((left, right) => EFFORT_ORDER.indexOf(left) - EFFORT_ORDER.indexOf(right));
}

function chooseEffort(model: CatalogModel, desired: Effort): Effort | null {
  const supported = supportedEfforts(model);
  if (supported.length === 0) return normalizeEffort(model.default_reasoning_level);
  if (supported.includes(desired)) return desired;

  const desiredIndex = EFFORT_ORDER.indexOf(desired);
  for (let index = desiredIndex + 1; index < EFFORT_ORDER.length; index += 1) {
    const candidate = EFFORT_ORDER[index];
    if (candidate && supported.includes(candidate)) return candidate;
  }
  for (let index = desiredIndex - 1; index >= 0; index -= 1) {
    const candidate = EFFORT_ORDER[index];
    if (candidate && supported.includes(candidate)) return candidate;
  }
  return supported[0] ?? null;
}

function chooseStrictlyHigherEffort(model: CatalogModel, current: Effort | null): Effort | null {
  if (!current) return chooseEffort(model, "high");
  const supported = supportedEfforts(model);
  const currentIndex = EFFORT_ORDER.indexOf(current);
  for (let index = currentIndex + 1; index < EFFORT_ORDER.length; index += 1) {
    const candidate = EFFORT_ORDER[index];
    if (candidate && supported.includes(candidate)) return candidate;
  }
  return current;
}

function modelScore(tier: Tier, model: CatalogModel): number {
  const haystack = `${model.slug} ${model.display_name ?? ""}`.toLowerCase();
  let score = 0;
  for (const [token, weight] of MODEL_TOKEN_WEIGHTS[tier]) {
    if (haystack.includes(token)) score += weight;
  }
  const priority = model.priority ?? 1000;
  score += Math.max(0, 2000 - Math.min(priority, 2000)) / 1000;
  return score;
}

function selectModel(tier: Tier, models: CatalogModel[]): CatalogModel | null {
  const scored = models
    .map((model) => ({ model, score: modelScore(tier, model) }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftPriority = left.model.priority ?? 1000;
      const rightPriority = right.model.priority ?? 1000;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.model.slug.localeCompare(right.model.slug);
    });
  return scored[0]?.model ?? null;
}

function isDeepSeekModel(model: CatalogModel): boolean {
  return model.slug.toLowerCase().includes("deepseek");
}

function selectDeepSeekModel(models: CatalogModel[], token: string): CatalogModel | null {
  return models.find((model) => isDeepSeekModel(model) && model.slug.toLowerCase().includes(token)) ?? null;
}

function planForDeepSeekOnly(models: CatalogModel[], source: string): RoutingPlan | null {
  const deepSeekModels = models.filter(isDeepSeekModel);
  if (deepSeekModels.length === 0 || deepSeekModels.length !== models.length) return null;

  const flash = selectDeepSeekModel(models, "flash") ?? deepSeekModels[0];
  const pro = selectDeepSeekModel(models, "pro") ?? flash;
  if (!flash || !pro) return null;

  const specs: Record<Tier, { model: CatalogModel; desiredEffort: Effort }> = {
    quick: { model: flash, desiredEffort: "low" },
    standard: { model: flash, desiredEffort: "high" },
    deep: { model: flash, desiredEffort: "max" },
    architect: { model: pro, desiredEffort: "max" },
  };

  const routes = {} as Record<Tier, RouteDefinition>;
  for (const tier of TIERS) {
    const spec = specs[tier];
    const reasoningEffort = chooseEffort(spec.model, spec.desiredEffort);
    routes[tier] = {
      agent: TIER_META[tier].agent,
      model: spec.model.slug,
      reasoning_effort: reasoningEffort,
      label: TIER_META[tier].label,
      model_resolution: reasoningEffort ? "dynamic" : "unavailable",
    };
  }

  return {
    routes,
    source,
    available_models: models.map((model) => model.slug),
    resolved: TIERS.every((tier) => routes[tier].reasoning_effort !== null),
  };
}

function emptyRoutingPlan(source: string, reason: string): RoutingPlan {
  const routes = {} as Record<Tier, RouteDefinition>;
  for (const tier of TIERS) {
    routes[tier] = {
      agent: TIER_META[tier].agent,
      model: null,
      reasoning_effort: null,
      label: TIER_META[tier].label,
      model_resolution: "unavailable",
    };
  }
  return {
    routes,
    source,
    available_models: [],
    resolved: false,
    fallback_reason: reason,
  };
}

function planFromCatalog(models: CatalogModel[], source: string): RoutingPlan {
  if (models.length === 0) return emptyRoutingPlan(source, "No usable models were found in the active catalog.");

  const deepSeekPlan = planForDeepSeekOnly(models, source);
  if (deepSeekPlan) return deepSeekPlan;

  const routes = {} as Record<Tier, RouteDefinition>;
  for (const tier of TIERS) {
    const model = selectModel(tier, models);
    if (!model) {
      routes[tier] = {
        agent: TIER_META[tier].agent,
        model: null,
        reasoning_effort: null,
        label: TIER_META[tier].label,
        model_resolution: "unavailable",
      };
      continue;
    }
    const reasoningEffort = chooseEffort(model, preferredEffortForModel(tier, model));
    routes[tier] = {
      agent: TIER_META[tier].agent,
      model: model.slug,
      reasoning_effort: reasoningEffort,
      label: TIER_META[tier].label,
      model_resolution: reasoningEffort ? "dynamic" : "unavailable",
    };
  }

  for (let index = 1; index < TIERS.length; index += 1) {
    const previousTier = TIERS[index - 1];
    const currentTier = TIERS[index];
    if (!previousTier || !currentTier) continue;
    const previous = routes[previousTier];
    const current = routes[currentTier];
    if (!previous.model || previous.model !== current.model) continue;

    const model = models.find((candidate) => candidate.slug === current.model) ?? null;
    if (!model) continue;
    const minimum = chooseStrictlyHigherEffort(model, previous.reasoning_effort);
    const currentIndex = current.reasoning_effort ? EFFORT_ORDER.indexOf(current.reasoning_effort) : -1;
    const minimumIndex = minimum ? EFFORT_ORDER.indexOf(minimum) : -1;
    if (minimumIndex > currentIndex) current.reasoning_effort = minimum;
  }

  return {
    routes,
    source,
    available_models: models.map((model) => model.slug),
    resolved: TIERS.every(
      (tier) => routes[tier].model !== null && routes[tier].reasoning_effort !== null && routes[tier].model_resolution === "dynamic",
    ),
  };
}

function planFromSpawnCapabilities(capabilities: SpawnCapabilities): RoutingPlan {
  const models: CatalogModel[] = [...capabilities.entries()].map(([slug, efforts], priority) => ({
    slug,
    supported_reasoning_levels: [...efforts],
    priority,
  }));
  return planFromCatalog(models, "session:spawn-capabilities");
}

async function readCatalogFile(filePath: string): Promise<CatalogModel[] | null> {
  try {
    const text = await readFile(filePath, "utf8");
    return parseCatalog(JSON.parse(text));
  } catch {
    return null;
  }
}

async function resolveConfiguredCatalogPath(): Promise<string> {
  const defaultPath = path.join(CODEX_HOME, "cc-switch-model-catalog.json");
  try {
    const config = await readFile(path.join(CODEX_HOME, "config.toml"), "utf8");
    const match = config.match(/^model_catalog_json\s*=\s*"([^"]+)"/m);
    const configured = match?.[1];
    if (!configured) return defaultPath;
    return path.isAbsolute(configured) ? configured : path.resolve(CODEX_HOME, configured);
  } catch {
    return defaultPath;
  }
}

async function resolveModelsUrl(options: Options): Promise<string | null> {
  if (options.modelsUrl) return options.modelsUrl;
  if (process.env.CC_SWITCH_MODELS_URL) return process.env.CC_SWITCH_MODELS_URL;
  try {
    const config = await readFile(path.join(CODEX_HOME, "config.toml"), "utf8");
    const providerId = config.match(/^model_provider\s*=\s*"([^"]+)"/m)?.[1];
    let baseUrl: string | undefined;
    if (providerId) {
      const escapedProviderId = providerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const section = config.match(
        new RegExp(`\\[model_providers\\.${escapedProviderId}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\[|$)`),
      )?.[1];
      baseUrl = section?.match(/^base_url\s*=\s*"([^"]+)"/m)?.[1];
    }
    baseUrl ??= config.match(/^base_url\s*=\s*"([^"]+)"/m)?.[1];
    if (baseUrl) return `${baseUrl.replace(/\/+$/, "")}/models`;
  } catch {
    // Fall through to the standard CC Switch proxy endpoint.
  }
  return null;
}

async function readLiveCatalog(url: string): Promise<CatalogModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseCatalog(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRoutingPlan(options: Options): Promise<RoutingPlan> {
  if (options.catalogPath) {
    const explicitPath = path.resolve(options.catalogPath);
    const models = await readCatalogFile(explicitPath);
    if (!models) return emptyRoutingPlan(`unavailable:${explicitPath}`, `Could not read model catalog: ${explicitPath}`);
    return planFromCatalog(models, `file:${explicitPath}`);
  }

  const configuredPath = await resolveConfiguredCatalogPath();
  const modelsUrl = await resolveModelsUrl(options);

  if (!options.noLiveModels && modelsUrl) {
    try {
      const models = await readLiveCatalog(modelsUrl);
      if (models.length > 0) return planFromCatalog(models, catalogIdentity(`live:${modelsUrl}`));
    } catch {
      // Use the catalog file when the active provider endpoint is unavailable.
    }
  }

  const models = await readCatalogFile(configuredPath);
  if (models) return planFromCatalog(models, `file:${configuredPath}`);
  const liveDescription = modelsUrl ? catalogIdentity(`live:${modelsUrl}`) : "(no live provider endpoint configured)";
  return emptyRoutingPlan(
    `unavailable:${configuredPath}`,
    `Could not load models from ${configuredPath} or ${liveDescription}.`,
  );
}

function serializeRoute(
  route: RouteDefinition,
  capabilities: SpawnCapabilities | null,
  profile: ProfileResolution,
  diagnosticRoute: RouteDefinition = route,
): SpawnRoute {
  if (route.model_resolution === "unavailable" || !route.model) {
    return { model: null, reasoning_effort: null, model_resolution: "unavailable", model_provider: null };
  }

  const catalogCandidate =
    diagnosticRoute.model_resolution === "dynamic" && diagnosticRoute.model
      ? { model: diagnosticRoute.model, reasoning_effort: diagnosticRoute.reasoning_effort }
      : null;

  const supportedEfforts = capabilities?.get(route.model);
  if (route.reasoning_effort && supportedEfforts?.has(route.reasoning_effort)) {
    return {
      model: route.model,
      reasoning_effort: route.reasoning_effort,
      model_resolution: "ready_override",
      model_provider: "spawn_override",
      ...(catalogCandidate ? { catalog_candidate: catalogCandidate } : {}),
    };
  }

  return {
    ...profile,
    ...(catalogCandidate ? { catalog_candidate: catalogCandidate } : {}),
  };
}

async function resolveExecutionRoutes(
  plan: RoutingPlan,
  capabilities: SpawnCapabilities | null,
  options: Options,
): Promise<Record<Tier, SpawnRoute>> {
  if (capabilities) {
    const sessionPlan = planFromSpawnCapabilities(capabilities);
    if (sessionPlan.resolved) {
      const unusedProfile: ProfileResolution = {
        model: null,
        reasoning_effort: null,
        model_resolution: "restart_required",
        model_provider: null,
      };
      return Object.fromEntries(
        TIERS.map((tier) => [
          tier,
          serializeRoute(sessionPlan.routes[tier], capabilities, unusedProfile, plan.routes[tier]),
        ]),
      ) as Record<Tier, SpawnRoute>;
    }
  }

  const profile = await resolveProfileState(plan, options);
  return Object.fromEntries(
    TIERS.map((tier) => [tier, serializeRoute(plan.routes[tier], null, profile)]),
  ) as Record<Tier, SpawnRoute>;
}

function renderGeneratedProfile(template: string, tier: Tier, route: RouteDefinition, fingerprint: string): string {
  const withoutGeneratedFields = template
    .split("\n")
    .filter(
      (line) =>
        !/^# Generated by codex-auto-router; fingerprint: /.test(line) &&
        !/^model\s*=/.test(line) &&
        !/^model_reasoning_effort\s*=/.test(line),
    )
    .join("\n");
  const withoutOldDescriptionMarker = withoutGeneratedFields.replace(
    /\s*\[codex-auto-router:[a-f0-9]{64}\](?=[^"]*"\s*$)/gm,
    "",
  );
  const names = [...withoutOldDescriptionMarker.matchAll(/^name\s*=\s*"([^"]+)"\s*$/gm)].map((match) => match[1]);
  if (names.length !== 1 || names[0] !== route.agent) {
    throw new Error(`Agent template ${tier}.toml must contain exactly one matching name field.`);
  }
  const descriptions = [...withoutOldDescriptionMarker.matchAll(/^description\s*=\s*"([^"]*)"\s*$/gm)];
  if (descriptions.length !== 1) {
    throw new Error(`Agent template ${tier}.toml must contain exactly one single-line description field.`);
  }
  if (!route.model || !route.reasoning_effort) throw new Error(`Route ${tier} is not fully resolved.`);
  const withDescriptionMarker = withoutOldDescriptionMarker.replace(
    /^description\s*=\s*"([^"]*)"\s*$/m,
    (_description, humanDescription: string) =>
      `description = "${humanDescription} [codex-auto-router:${fingerprint}]"`,
  );
  return withDescriptionMarker.replace(
    /^name\s*=\s*"[^"]+"\s*$/m,
    (name) =>
      `${name}\n# Generated by codex-auto-router; fingerprint: ${fingerprint}\nmodel = "${route.model}"\nmodel_reasoning_effort = "${route.reasoning_effort}"`,
  );
}

async function readAgentTemplate(tier: Tier): Promise<string> {
  const installedTemplate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../agent-templates", `${tier}.toml`);
  try {
    return await readFile(installedTemplate, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const repositoryTemplate = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../agents", `${tier}.toml`);
  try {
    return await readFile(repositoryTemplate, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return readFile(path.join(CODEX_HOME, "agents", `${tier}.toml`), "utf8");
}

async function syncAgents(options: Options) {
  const plan = await loadRoutingPlan(options);
  if (!plan.resolved || TIERS.some((tier) => !plan.routes[tier].model || !plan.routes[tier].reasoning_effort)) {
    return {
      action: "sync-agents",
      model_resolution: "unavailable",
      model_catalog_source: plan.source,
      available_models: plan.available_models,
      resolution_reason: plan.fallback_reason ?? "The active catalog did not produce four complete model/effort routes.",
    };
  }

  const fingerprint = planFingerprint(plan);
  const rendered = new Map<Tier, string>();
  try {
    for (const tier of TIERS) {
      rendered.set(tier, renderGeneratedProfile(await readAgentTemplate(tier), tier, plan.routes[tier], fingerprint));
    }
  } catch (error) {
    return {
      action: "sync-agents",
      model_resolution: "blocked",
      model_catalog_source: plan.source,
      fingerprint,
      resolution_reason: `Agent profile generation failed before installation: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const agentsDir = path.join(CODEX_HOME, "agents");
  await mkdir(agentsDir, { recursive: true });
  const stageDir = await mkdtemp(path.join(CODEX_HOME, ".codex-auto-router-stage-"));
  const backupDir = path.join(CODEX_HOME, "backups", `codex-auto-router-sync-${Date.now()}-${process.pid}`);
  const statePath = path.join(CODEX_HOME, "codex-auto-router-state.json");
  const targets = TIERS.map((tier) => path.join(agentsDir, `${tier}.toml`));
  const previous = new Map<string, boolean>();
  let backupCreated = false;

  try {
    for (const tier of TIERS) {
      await writeFile(path.join(stageDir, `${tier}.toml`), rendered.get(tier) ?? "", { encoding: "utf8", mode: 0o600 });
    }
    const state = {
      version: 1,
      fingerprint,
      catalog_identity: catalogIdentity(plan.source),
      routes: normalizedRoutes(plan),
      generated_at: new Date().toISOString(),
    };
    await writeFile(path.join(stageDir, "codex-auto-router-state.json"), `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });

    for (const target of [...targets, statePath]) {
      try {
        await readFile(target);
        previous.set(target, true);
        if (!backupCreated) {
          await mkdir(backupDir, { recursive: true });
          backupCreated = true;
        }
        await copyFile(target, path.join(backupDir, path.basename(target)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        previous.set(target, false);
      }
    }

    for (const tier of TIERS) {
      await rename(path.join(stageDir, `${tier}.toml`), path.join(agentsDir, `${tier}.toml`));
    }
    await rename(path.join(stageDir, "codex-auto-router-state.json"), statePath);
  } catch (error) {
    for (const target of [...targets, statePath]) {
      try {
        if (previous.get(target)) await copyFile(path.join(backupDir, path.basename(target)), target);
        else if (previous.has(target)) await rm(target, { force: true });
      } catch {
        // Preserve the original installation error; rollback is best effort.
      }
    }
    return {
      action: "sync-agents",
      model_resolution: "blocked",
      model_catalog_source: plan.source,
      fingerprint,
      resolution_reason: `Atomic profile installation failed: ${error instanceof Error ? error.message : String(error)}`,
      ...(backupCreated ? { backup_dir: backupDir } : {}),
    };
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }

  return {
    action: "sync-agents",
    model_resolution: "restart_required",
    model_catalog_source: plan.source,
    fingerprint,
    updated_profiles: TIERS.map((tier) => path.join(agentsDir, `${tier}.toml`)),
    state_file: statePath,
    ...(backupCreated ? { backup_dir: backupDir } : {}),
    next_step:
      "Start a fresh Codex task or restart the client; extract the common fingerprint from all four loaded agent descriptions and pass it with --loaded-profile-fingerprint.",
  };
}

function resolutionMetadata(route: SpawnRoute) {
  return {
    ...(route.fingerprint ? { fingerprint: route.fingerprint } : {}),
    ...(route.sync_command ? { sync_command: route.sync_command } : {}),
    ...(route.next_step ? { next_step: route.next_step } : {}),
    ...(route.resolution_reason ? { resolution_reason: route.resolution_reason } : {}),
  };
}

function buildResult(
  task: string,
  tier: Tier,
  confidence: number,
  method: string,
  reasons: string[],
  plan: RoutingPlan,
  routes: Record<Tier, SpawnRoute>,
  extra: Record<string, unknown> = {},
) {
  const route = plan.routes[tier];
  const model = routes[tier];
  return {
    action: "route",
    task_summary: task.replace(/\s+/g, " ").slice(0, 500),
    tier,
    agent: route.agent,
    model: model.model,
    model_provider: model.model_provider,
    reasoning_effort: model.reasoning_effort,
    model_resolution: model.model_resolution,
    ...(model.catalog_candidate ? { catalog_candidate: model.catalog_candidate } : {}),
    ...resolutionMetadata(model),
    model_catalog_source: plan.source,
    available_models: plan.available_models,
    confidence,
    method,
    reasons,
    escalation_order: TIERS,
    ...(plan.fallback_reason ? { model_catalog_fallback_reason: plan.fallback_reason } : {}),
    ...extra,
  };
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if ([429, 500, 502, 503, 504, 529].includes(response.status) && attempt < attempts) {
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("TypeSafe request failed");
}

async function callTypesafe(
  task: string,
  context: string,
): Promise<DeterministicResult & { typesafe_model: string; probabilities: Record<string, number> }> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set");

  const payload = {
    state: {
      task,
      repository_context: context || "(not supplied)",
    },
    model: "jev-latest",
    questions: {
      tier: {
        type: "choice",
        instructions:
          "Choose the cheapest Codex execution tier that is still sufficient to complete this software-engineering task correctly. Judge scope, risk, uncertainty, need for cross-module tracing, architecture/concurrency/security impact, and whether the task can be verified locally.",
        criteria: {
          quick:
            "Bounded retrieval or deterministic mechanical work: search, locate, read, summarize, format, rename, or a clearly known low-risk edit.",
          standard:
            "Normal feature work, localized bug fix, tests, ordinary refactor, API integration, or clear-scope frontend/backend implementation.",
          deep:
            "Difficult debugging, root-cause analysis, cross-module change, performance, concurrency, security, migration, intermittent failure, or material ambiguity.",
          architect:
            "Whole-system or cross-service architecture, platform-wide redesign, irreversible or high-risk tradeoff, public contract decision, or escalation after deep failure.",
        },
      },
    },
  };

  const response = await fetchWithRetry("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await response.json()) as {
    model?: string;
    answers?: { tier?: { choice?: unknown; confidence?: unknown; probabilities?: Record<string, number> } };
    error?: unknown;
  };

  if (!response.ok) {
    throw new Error(`TypeSafe HTTP ${response.status}: ${JSON.stringify(body.error ?? body)}`);
  }

  const answer = body.answers?.tier;
  const tier = normalizeTier(answer?.choice);
  if (!tier) throw new Error(`TypeSafe returned an unknown tier: ${JSON.stringify(answer?.choice)}`);

  const confidence = Number(answer?.confidence);
  return {
    tier,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    reasons: ["TypeSafe System One semantic route."],
    typesafe_model: body.model ?? "jev-latest",
    probabilities: answer?.probabilities ?? {},
  };
}

async function routeTask(options: Options) {
  const [task, plan] = await Promise.all([readTask(options), loadRoutingPlan(options)]);
  const capabilities = parseSpawnCapabilities(options.spawnCapabilities);
  const routes = await resolveExecutionRoutes(plan, capabilities, options);
  const deterministic = classifyDeterministic(task);
  if (deterministic && !options.forceTypesafe && !options.noTypesafe) {
    return buildResult(task, deterministic.tier, deterministic.confidence, "deterministic", deterministic.reasons, plan, routes);
  }

  if (!options.noTypesafe) {
    try {
      const judged = await callTypesafe(task, options.context);
      let tier = judged.tier;
      let method = "typesafe";
      const reasons = [...judged.reasons];
      if (tier === "quick" && hasMixedQuickAndMutation(task)) {
        tier = "standard";
        method = "typesafe+mutation-floor";
        reasons.push("A retrieval or mechanical signal is combined with a mutation; QUICK is insufficient.");
      }
      if (judged.confidence < options.minConfidence && tier !== "architect") {
        const baseTier = tier;
        tier = nextTier(tier);
        method = "typesafe+confidence-escalation";
        reasons.push(
          `TypeSafe confidence ${judged.confidence.toFixed(3)} is below ${options.minConfidence.toFixed(3)}; escalated ${baseTier} -> ${tier}.`,
        );
      }
      return buildResult(task, tier, judged.confidence, method, reasons, plan, routes, {
        typesafe_model: judged.typesafe_model,
        probabilities: judged.probabilities,
      });
    } catch (error) {
      const fallback = classifyFallback(task);
      return buildResult(
        task,
        fallback.tier,
        fallback.confidence,
        "fallback",
        [...fallback.reasons, error instanceof Error ? error.message : String(error)],
        plan,
        routes,
        { typesafe_available: false },
      );
    }
  }

  const fallback = deterministic ?? classifyFallback(task);
  return buildResult(task, fallback.tier, fallback.confidence, "deterministic-fallback", fallback.reasons, plan, routes, {
    typesafe_available: false,
  });
}

async function escalate(options: Options) {
  const current = normalizeTier(options.currentTier);
  if (!current) throw new Error("Use --current quick|standard|deep|architect");
  const plan = await loadRoutingPlan(options);
  const capabilities = parseSpawnCapabilities(options.spawnCapabilities);
  const routes = await resolveExecutionRoutes(plan, capabilities, options);
  const next = nextTier(current);
  const route = plan.routes[next];
  const model = routes[next];
  return {
    action: "escalate",
    current_tier: current,
    next_tier: next,
    agent: route.agent,
    model: model.model,
    model_provider: model.model_provider,
    reasoning_effort: model.reasoning_effort,
    model_resolution: model.model_resolution,
    ...(model.catalog_candidate ? { catalog_candidate: model.catalog_candidate } : {}),
    ...resolutionMetadata(model),
    model_catalog_source: plan.source,
    available_models: plan.available_models,
    escalated: next !== current,
    reason: options.reason || "Policy-defined escalation trigger.",
    escalation_order: TIERS,
    ...(plan.fallback_reason ? { model_catalog_fallback_reason: plan.fallback_reason } : {}),
  };
}

function runSelfTest() {
  const cases: Array<{ task: string; expected: Tier | null }> = [
    { task: "查找 UserService 在哪里", expected: "quick" },
    { task: "搜索并列出所有认证中间件", expected: "quick" },
    { task: "修复偶发死锁和竞态条件", expected: "deep" },
    { task: "分析线上间歇 500 的根因", expected: "deep" },
    { task: "重新设计跨系统认证架构", expected: "architect" },
    { task: "实现登录功能并补测试", expected: null },
  ];

  const results: Array<{ task: string; expected: unknown; actual: unknown; pass: boolean }> = cases.map((testCase) => {
    const result = classifyDeterministic(testCase.task);
    const actual = result?.tier ?? null;
    return { task: testCase.task, expected: testCase.expected, actual, pass: actual === testCase.expected };
  });

  const deepseekPlan = planFromCatalog(
    [
      {
        slug: "deepseek-flash",
        display_name: "deepseek-flash",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "max" }],
      },
      {
        slug: "deepseek-v4-pro",
        display_name: "DeepSeek V4 Pro",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }, { effort: "max" }],
      },
    ],
    "selftest:deepseek",
  );
  const deepseekExpected = {
    quick: ["deepseek-flash", "low"],
    standard: ["deepseek-flash", "high"],
    deep: ["deepseek-flash", "max"],
    architect: ["deepseek-v4-pro", "max"],
  };
  const deepseekActual = Object.fromEntries(
    TIERS.map((tier) => [tier, [deepseekPlan.routes[tier].model, deepseekPlan.routes[tier].reasoning_effort]]),
  );
  results.push({
    task: "dynamic deepseek catalog",
    expected: deepseekExpected,
    actual: deepseekActual,
    pass: JSON.stringify(deepseekActual) === JSON.stringify(deepseekExpected),
  });

  const gptPlan = planFromCatalog(
    [
      {
        slug: "gpt-6-luna",
        display_name: "GPT-6 Luna",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
      },
      {
        slug: "gpt-6-sol",
        display_name: "GPT-6 Sol",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
      },
      {
        slug: "gpt-6-astra",
        display_name: "GPT-6 Astra",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
      },
    ],
    "selftest:gpt-6",
  );
  const gptExpected = {
    quick: ["gpt-6-luna", "high"],
    standard: ["gpt-6-sol", "medium"],
    deep: ["gpt-6-sol", "high"],
    architect: ["gpt-6-astra", "high"],
  };
  const gptActual = Object.fromEntries(
    TIERS.map((tier) => [tier, [gptPlan.routes[tier].model, gptPlan.routes[tier].reasoning_effort]]),
  );
  results.push({
    task: "dynamic gpt catalog",
    expected: gptExpected,
    actual: gptActual,
    pass: JSON.stringify(gptActual) === JSON.stringify(gptExpected),
  });

  const gptNoAstraPlan = planFromCatalog(
    [
      {
        slug: "gpt-5.6-luna",
        display_name: "GPT-5.6 Luna",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }],
      },
      {
        slug: "gpt-5.6-terra",
        display_name: "GPT-5.6 Terra",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
      },
      {
        slug: "gpt-5.6-sol",
        display_name: "GPT-5.6 Sol",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "xhigh" }],
      },
    ],
    "selftest:gpt-no-astra",
  );
  const gptNoAstraExpected = {
    quick: ["gpt-5.6-luna", "low"],
    standard: ["gpt-5.6-terra", "medium"],
    deep: ["gpt-5.6-sol", "high"],
    architect: ["gpt-5.6-sol", "xhigh"],
  };
  const gptNoAstraActual = Object.fromEntries(
    TIERS.map((tier) => [tier, [gptNoAstraPlan.routes[tier].model, gptNoAstraPlan.routes[tier].reasoning_effort]]),
  );
  results.push({
    task: "dynamic gpt catalog without astra",
    expected: gptNoAstraExpected,
    actual: gptNoAstraActual,
    pass: JSON.stringify(gptNoAstraActual) === JSON.stringify(gptNoAstraExpected),
  });

  const failures = results.filter((result) => !result.pass);
  return { ok: failures.length === 0, checks: results, failures };
}

function helpText(): string {
  return `codex-auto-router

Usage:
  route.ts route --stdin [--context "repo and task context"] [--pretty]
  route.ts route --task "..." [--no-typesafe]
  route.ts escalate --current quick --reason "..." [--pretty]
  route.ts routes [--pretty]
  route.ts sync-agents [--catalog <path> | --models-url <url>] [--pretty]
  route.ts selftest

Model catalog:
  --catalog <path>       Use a specific model catalog JSON file.
  --models-url <url>     Read the live model list from this endpoint.
  --no-live-models       Use the catalog file only; skip the local models endpoint.
  --spawn-capabilities   Validated JSON supplied by the parent from the current spawn tool schema.
  --loaded-profile-fingerprint <sha256>
                         Common fingerprint marker observed in all four loaded agent descriptions.

Environment:
  TYPESAFE_API_KEY       Required for semantic routing of ambiguous tasks.
  CC_SWITCH_MODELS_URL   Optional override for the live models endpoint.

The script prints one JSON object. It never prints the API key.`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  let result: unknown;

  if (options.command === "help") {
    process.stdout.write(`${helpText()}\n`);
    return;
  }

  if (options.command === "route") {
    result = await routeTask(options);
  } else if (options.command === "escalate") {
    result = await escalate(options);
  } else if (options.command === "routes") {
    const plan = await loadRoutingPlan(options);
    const routes = await resolveExecutionRoutes(plan, parseSpawnCapabilities(options.spawnCapabilities), options);
    result = {
      action: "routes",
      routes: Object.fromEntries(TIERS.map((tier) => [tier, { ...plan.routes[tier], ...routes[tier] }])),
      model_catalog_source: plan.source,
      available_models: plan.available_models,
      resolved: TIERS.every((tier) => ["ready_override", "ready_profile"].includes(routes[tier].model_resolution)),
      catalog_resolved: plan.resolved,
      ...(plan.fallback_reason ? { model_catalog_fallback_reason: plan.fallback_reason } : {}),
      escalation_order: TIERS,
    };
  } else if (options.command === "sync-agents") {
    result = await syncAgents(options);
  } else if (options.command === "selftest") {
    result = { action: "selftest", ...runSelfTest() };
  } else {
    throw new Error(`Unknown command: ${options.command}`);
  }

  process.stdout.write(`${JSON.stringify(result, null, options.pretty ? 2 : 0)}\n`);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entrypoint) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
