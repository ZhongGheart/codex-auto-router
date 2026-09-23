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
核对后使用模型覆盖，或继承当前会话设置启动子智能体
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

最新 GPT 模型按照 OpenAI 官方模型建议映射：

```text
quick      -> gpt-6-luna   / high
standard   -> gpt-6-sol    / medium
deep       -> gpt-6-sol    / high
architect  -> gpt-6-astra  / high
```

GPT-5.6 在过渡期作为回退：

```text
quick      -> gpt-5.6-luna  / low
standard   -> gpt-5.6-terra / medium
deep       -> gpt-5.6-sol   / high
architect  -> gpt-5.6-sol   / xhigh
```

如果 GPT-6 Astra 不可用，`architect` 会回退到 `gpt-6-sol`，并提升到支持的下一个推理等级，例如 `xhigh`。

当前目录只有 DeepSeek 模型时，路由器使用：

```text
quick      -> deepseek-flash   / low
standard   -> deepseek-flash   / high
deep       -> deepseek-flash   / max
architect  -> deepseek-v4-pro  / max
```


四个 Agent 文件故意不写死 `model` 和 `model_reasoning_effort`。路由器将目录中的选择放在 `catalog_candidate`，并返回空的 `model`、`reasoning_effort` 覆盖值和 `model_resolution: catalog_unverified`。父 Agent 先核对当前会话的 spawn 工具是否接受候选模型及推理等级；若不接受，则以继承设置启动所选等级的 Agent。切换 CC Switch Provider 时无需修改 Agent 文件。

## 要求

- 支持自定义 Agent 和 subagent 的 Codex
- Node.js 22+
- 模糊任务判级需要 `TYPESAFE_API_KEY`
- 可选：CC Switch 本地代理

确定性快速路径不依赖 TypeSafe。如果模型目录读取失败，路由结果会返回 `model_resolution: unavailable`，此时使用继承的模型设置，不会猜测模型名。目录候选在当前会话确认可用前，不会作为已验证的 spawn 模型。

## 安装

```bash
git clone https://github.com/ZhongGheart/codex-auto-router.git
cd codex-auto-router
./scripts/install.sh
```

安装脚本会：

- 安装 Skill 到 `${AGENTS_HOME:-$HOME/.agents}/skills/codex-auto-router`
- 安装四个 Agent 到 `${CODEX_HOME:-$HOME/.codex}/agents`
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

- CC Switch 切换 Provider 后，建议新开 Codex 任务或重启客户端，让 spawn 的模型可选列表同步。
- 插件清单用于打包 Skill；自定义 Agent TOML 仍通过安装脚本写入用户级 Codex Agent 目录。
- 路由脚本不会打印或持久化 TypeSafe API Key。

## License

MIT
