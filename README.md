# dsh-pipeline

DeepSeek Harness（dsh）多节点工作流编排插件 —— 回应官方讨论
[#7704](https://github.com/deepseek-ai/deepseek-harness/discussions/7704)：
把多节点（每节点独立 prompt/model）、可保存复用的 agent 流水线，
以 JSON 定义、一键编译并运行。

> **状态：M1（编译器 + runner + `/pipeline` 命令/`pipeline` 工具）**。
> 完整 README（特性/架构图/快速开始）将随 M5 发布补齐；
> 设计与任务编排文档见 [`plan/`](./plan/00-总览README.md)。

## 开发

要求：Node ≥ 20，pnpm ≥ 10。

```sh
pnpm install
pnpm build        # tsc -> lib/
pnpm test         # node:test（离线，零 API 依赖；含 B1-B3 基准断言）
pnpm bench        # 离线基准指标表（B1-B3）
pnpm lint         # tsc --noEmit
```

## 内置基准评测（plan/04，全部离线可重复）

| 基准 | 输入 | 判据 | 当前指标 |
|---|---|---|---|
| B1 编译快照 | `data/pipelines/*.json`（5 份） | 编译输出与 `data/snapshots/` 逐字节一致 | **5/5，0 diff** |
| B2 校验矩阵 | `data/invalid/*.json`（18 份）+ 合法集 | 按冻结清单接受/拒绝且错误码正确 | **23/23，100%** |
| B3 mock 引擎 e2e | mock WorkflowEngine × 4 场景 | agent() 调用参数序列 + 事件序完全匹配；取消后无残留调用 | **4/4，完全匹配** |

复现：`pnpm bench` 一条命令出全部指标（零 API 依赖、零模型调用）。
B4（失败策略矩阵 abort/skip/retry）随 M2 落地。快照真值冻结口径见
`data/README.md` 与 `plan/HANDOFF-M2.md` 的既定口径清单。

## 用法（M1 能力面）

定义存放在工作区 `.dsh/pipelines/<name>.json`（格式见 `data/pipelines/`
示例：节点内多条 prompt、`{{input}}`/`{{<节点id>}}`/`{{prev}}` 模板变量、
每节点 `model` 路由、`dependsOn` 显式 DAG、`outputSchema` 结构化输出）：

```sh
/pipeline list                     # 列出已保存流水线
/pipeline show <name>              # 打印定义 + 校验状态
/pipeline run <name> [输入...]      # 直接运行（不经模型轮次）
```

或让模型调用 `pipeline` 工具（参数 `{ name, input }`）在对话中发起。
编译产物为普通 JS workflow 引擎脚本（无 eval），经 `ctx.workflowEngine`
在 worker 线程运行；子 agent 共享会话工作区。能力探测先行：provider 缺
`agentOptions`/`outputSchema` 时运行前报可读错误，绝不静默降级。

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

M1 演示证据（离线全链路 trace + 实机装载日志）见
[`plan/m1-demo-log.md`](./plan/m1-demo-log.md)；在线冒烟（真实 API 跑
three-node-two-models）为人工门，待配置 `DEEPSEEK_API_KEY` 后执行。

## License

[MIT](./LICENSE)
