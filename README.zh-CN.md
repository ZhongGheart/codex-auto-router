# Codex Auto Router

面向 Codex 子智能体的动态任务分级与模型路由 Skill。

`codex-auto-router` 会为软件开发任务选择最低但足够的执行等级，从当前 CC Switch 模型目录提出模型和推理等级候选，并只在证据要求时升级。

[English README](README.md)

## 功能

```text
用户任务
   |
   v
codex-auto-router
   |
   +-- 确定性快速路径
   |
   +-- TypeSafe 判级（模糊任务）
   |
   v
quick / standard / deep / architect
   |
   v
从目录选择模型与推理等级候选
   |
   v
使用已验证的模型覆盖，或使用指纹完全匹配的生成配置
```

仓库包含：

- 可移植的 Codex Skill
- 四个全局自定义 Agent
- CC Switch 实时模型解析器
- TypeSafe 路由脚本
- 幂等安装脚本
- 测试与 GitHub Actions CI
- `.codex-plugin/plugin.json` 插件清单

## 执行等级

| 等级 | 用途 | 常见模型 |
| --- | --- | --- |
| `quick` | 搜索、定位、读取、总结、格式化、重命名、确定性机械修改 | Luna / Flash / Mini |
| `standard` | 普通功能、局部修复、测试、范围明确的实现 | Sol / Terra / Pro |
| `deep` | 难排查问题、跨模块、性能、并发、安全、迁移 | Sol / Pro |
| `architect` | 系统级设计、跨服务权衡、不可逆决策、Deep 多次失败 | Astra / 当前最强模型 |

## 动态模型解析

每次运行时按以下顺序解析模型：

1. 当前 Provider 的 `base_url + /models`
2. `CC_SWITCH_MODELS_URL` 或 `--models-url`
3. `~/.codex/config.toml` 中的 `model_catalog_json`
4. 测试或恢复时显式传入的 `--catalog`

当前会话支持 GPT-6.1 Sol 时，优先映射为：

```text
quick      -> gpt-6-luna   / high
standard   -> gpt-6.1-sol  / medium
deep       -> gpt-6.1-sol  / high
architect  -> gpt-6-astra  / high
```

GPT-5.6 在过渡期作为回退：

```text
quick      -> gpt-5.6-luna  / low
standard   -> gpt-5.6-terra / medium
deep       -> gpt-5.6-sol   / high
architect  -> gpt-5.6-sol   / xhigh
```

如果 GPT-6 Astra 不可用，`architect` 会回退到 `gpt-6.1-sol`，并提升到支持的下一个推理等级，例如 `xhigh`。如果 GPT-6.1 Sol 也不可用，则保留原有的 `gpt-6-sol` 映射。

当前目录只有 DeepSeek 模型时，路由器使用：

```text
quick      -> deepseek-flash   / low
standard   -> deepseek-flash   / high
deep       -> deepseek-flash   / max
architect  -> deepseek-v4-pro  / max
```


仓库中的四个 Agent 文件是稳定的指令模板，故意不写死 `model` 和 `model_reasoning_effort`。父 Agent 通过 `--spawn-capabilities` 传入当前 spawn 工具按模型列出的能力；路由器据此评分并生成完整的四层计划，且只选择该模型明确支持的推理等级。当前会话计划是可执行 `ready_override` 的权威来源，即使模型目录已过期或属于另一模型家族，目录候选与来源也只保留为诊断信息。只有会话能力无法形成完整计划时，才使用生成配置；此时磁盘状态必须与当前目录身份、完整路由表指纹完全一致，并且当前会话加载的四个 Agent 描述都暴露同一指纹，才返回 `ready_profile`。

配置缺失或过期时返回 `restart_required`，并给出 `sync-agents` 命令和新开任务/重启提示；目录失败返回 `unavailable`；配置状态无法验证时返回 `blocked`。继承父会话设置不再被视为自动模型路由成功。

## 要求

- 支持自定义 Agent 和 subagent 的 Codex
- Node.js 22+
- 模糊任务判级需要 `TYPESAFE_API_KEY`
- 可选：CC Switch 本地代理

确定性快速路径不依赖 TypeSafe。父 Agent 必须保留用户明确指定的模型或推理等级，不得用自动路由替换。Skill 无法自省自己的 spawn schema、重载自定义 Agent 或重启 Codex，因此会话能力必须由父 Agent 提供。只有显式会话覆盖无法提供完整路由时才同步配置；同步后必须新开任务或重启客户端。

## 安装

```bash
git clone https://github.com/ZhongGheart/codex-auto-router.git
cd codex-auto-router
./scripts/install.sh
```

安装脚本会：

- 安装 Skill 到 `${AGENTS_HOME:-$HOME/.agents}/skills/codex-auto-router`
- 在 Skill 旁安装规范 Agent 模板，并只向 `${CODEX_HOME:-$HOME/.codex}/agents` 补齐缺失的 Agent
- 向 `AGENTS.md` 追加幂等的 `codex-auto-router` 路由规则
- 修改前备份已有 Skill、Agent 和 `AGENTS.md`

安装后请新开一个 Codex 任务，让全局 Agent 生效。

## TypeSafe 配置

在启动 Codex 的环境中设置：

```bash
export TYPESAFE_API_KEY="..."
```

遇到模糊任务时，路由脚本会调用 `https://api.typesafe.ai/v1/systemone`，使用 `jev-latest` 进行类型化判级。

## 使用

安装后正常提需求即可。全局路由规则和 Skill 描述会在实质性软件开发任务前触发自动路由。

也可以显式调用：

```text
$codex-auto-router 帮我诊断登录偶发失败并补回归测试
```

查看当前映射：

```bash
node --experimental-strip-types \
  skills/codex-auto-router/scripts/route.ts routes --pretty
```

路由时传入当前 spawn schema（父 Agent 从工具定义生成该 JSON）：

```bash
node --experimental-strip-types \
  skills/codex-auto-router/scripts/route.ts route \
  --task "查找认证中间件" \
  --spawn-capabilities '{"models":[{"model":"gpt-6-luna","reasoning_efforts":["low","medium","high"]}]}' \
  --pretty
```

若结果为 `restart_required`，运行返回的 `sync_command`，或直接同步：

```bash
node --experimental-strip-types \
  skills/codex-auto-router/scripts/route.ts sync-agents --pretty
```

同步会先验证并暂存四个配置，备份将替换的文件，保留无关 Agent，写入 `${CODEX_HOME}/codex-auto-router-state.json`，并在每个生成的 Agent 描述末尾追加 `[codex-auto-router:<fingerprint>]`。随后必须新开任务或重启客户端。从新会话的 spawn schema 中提取 `quick`、`standard`、`deep`、`architect` 描述里的同一标记，并在每次 route/escalation 时传入：

```bash
--loaded-profile-fingerprint <sha256>
```

标记缺失、不一致或过期时，即使磁盘文件已经匹配，仍返回 `restart_required`。

运行自检：

```bash
node --experimental-strip-types \
  skills/codex-auto-router/scripts/route.ts selftest
```

## 开发

```bash
npm test
```

测试覆盖：

- DeepSeek、GPT-6 与 GPT-5.6 模型目录适配
- Astra 缺失时的回退与推理等级提升
- 实时 `/v1/models` 发现
- 以会话 spawn schema 为权威的规划、跨模型家族目录诊断与显式解析状态
- 生成配置的原子同步、指纹、备份与失败保护
- 插件清单完整性
- 安装脚本幂等性

## 目录结构

```text
.codex-plugin/plugin.json
agents/
  quick.toml
  standard.toml
  deep.toml
  architect.toml
skills/codex-auto-router/
  SKILL.md
  references/routing-policy.md
  scripts/route.ts
scripts/install.sh
tests/
```

## 说明

- CC Switch 切换 Provider 或同步配置后，必须新开 Codex 任务或重启客户端，并传入新 spawn schema 中四个 Agent 的共同指纹。
- 插件清单用于打包 Skill；自定义 Agent TOML 仍通过安装脚本写入用户级 Codex Agent 目录。
- 路由脚本不会打印或持久化 TypeSafe API Key。

## License

MIT
