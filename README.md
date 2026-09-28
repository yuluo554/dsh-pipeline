# dsh-pipeline

DeepSeek Harness（dsh）多节点工作流编排插件 —— 回应官方讨论
[#7704](https://github.com/deepseek-ai/deepseek-harness/discussions/7704)：
把多节点（每节点独立 prompt/model/skill、失败策略）、可保存复用的 agent 流水线，
以 JSON 定义、一键编译并运行。

> **状态：M3（Web 半编辑器：设置区表单编辑器 + 会话头运行入口，零手写 JSON 配置；host 护栏与失败策略同 M2）**。
> 完整 README（特性/架构图/快速开始）将随 M5 发布补齐；
> 设计与任务编排文档见 [`plan/`](./plan/00-总览README.md)。

## 开发

要求：Node ≥ 20，pnpm ≥ 10。

```sh
pnpm install
pnpm build        # tsc -> lib/
pnpm test         # node:test（离线，零 API 依赖；含 B1-B4 基准断言 + 真实引擎取消/策略测试）
pnpm bench        # 离线基准指标表（B1-B4）
pnpm lint         # tsc --noEmit
```

## 内置基准评测（plan/04，全部离线可重复）

| 基准 | 输入 | 判据 | 当前指标 |
|---|---|---|---|
| B1 编译快照 | `data/pipelines/*.json`（7 份） | 编译输出与 `data/snapshots/` 逐字节一致 | **7/7，0 diff** |
| B2 校验矩阵 | `data/invalid/*.json`（15 份）+ 合法集 | 按冻结清单接受/拒绝且错误码正确 | **22/22，100%** |
| B3 mock 引擎 e2e | mock WorkflowEngine × 4 场景 | agent() 调用参数序列 + 事件序完全匹配；取消后无残留调用 | **4/4，完全匹配** |
| B4 策略矩阵 | 注入失败节点 × abort/skip/retry × 6 场景 | 各策略结果/事件序符合语义（skip 置 null 继续；retry 节点级重跑、耗尽按策略收场；取消打断重试不失控） | **6/6，完全匹配** |

复现：`pnpm bench` 一条命令出全部指标（零 API 依赖、零模型调用）。
快照真值冻结口径见 `data/README.md` 与 `plan/HANDOFF-M3.md` 的既定口径清单。

## 用法（M1+M2 能力面）

定义存放在工作区 `.dsh/pipelines/<name>.json`（格式见 `data/pipelines/`
示例：节点内多条 prompt、`{{input}}`/`{{<节点id>}}`/`{{prev}}` 模板变量、
每节点 `model` 路由、`dependsOn` 显式 DAG、`outputSchema` 结构化输出、
每节点 `skills` 技能注入、`failurePolicy`（abort/skip）与 `retry` 重试、
流水线级 `options.defaultFailurePolicy`）：

```sh
/pipeline list                     # 列出已保存流水线
/pipeline show <name>              # 打印定义 + 校验状态
/pipeline run <name> [输入...]      # 直接运行（不经模型轮次）
```

或让模型调用 `pipeline` 工具（参数 `{ name, input }`）在对话中发起。
编译产物为普通 JS workflow 引擎脚本（无 eval），经 `ctx.workflowEngine`
在 worker 线程运行；子 agent 共享会话工作区；失败策略编译进脚本，取消
（会话中断/AbortSignal）经引擎共享 signal 传播到全部受管子 agent，干净结算。
能力探测先行：provider 缺 `agentOptions`/`outputSchema` 时运行前报可读错误，
绝不静默降级；声明 `skills` 的节点在起跑前经 `ctx.skills` 解析，缺技能 fail-loud。
错误信息支持 en/zh（插件配置 `locale`，默认 en）。

已知闸门（编译期显式拒绝，不静默忽略）：节点级 `tools` 路由与
`model.reasoningEffort`——0.1.5-rc.1 引擎无对应通路（plan/06 决策记录）。

## 本地安装验证（M1 演示回路）

在**本仓库的父目录**执行（相对路径写法参照官方发布教程）：

```sh
dsh plugin --profile web add ./dsh-pipeline   # link 安装进 profile
dsh --profile web --dump-config               # 应可见 "# == dsh-pipeline" 层
dsh --profile web                             # 启动；apply 日志含注册与自检结果
dsh plugin --profile web remove dsh-pipeline  # 卸载：层消失、注册随 effect 注销
```

安装即用：本插件的 bundle patch 会启用 web profile 默认禁用的
`workflow-worker-thread` 引擎（插件是它的专用消费方）；官方面向模型的
`workflow` 工具保持原样，两者共存。

M1/M2 演示证据（离线全链路 trace + 策略/取消演示 + 实机装载日志）见
[`plan/m1-demo-log.md`](./plan/m1-demo-log.md) 与
[`plan/m2-demo-log.md`](./plan/m2-demo-log.md)；在线冒烟（真实 API 跑
three-node-two-models）为人工门，待配置 `DEEPSEEK_API_KEY` 后执行。

## License

[MIT](./LICENSE)
