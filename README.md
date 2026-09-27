# dsh-pipeline

DeepSeek Harness（dsh）多节点工作流编排插件 —— 回应官方讨论
[#7704](https://github.com/deepseek-ai/deepseek-harness/discussions/7704)：
把多节点（每节点独立 prompt/model/skill）、可保存复用的 agent 流水线，
以 JSON 定义、一键编译并运行。

> **状态：M0（bundle 骨架 + hello 工具）**。
> 完整 README（特性/架构图/快速开始/评测表）将随 M5 发布补齐；
> 设计与任务编排文档见 [`plan/`](./plan/00-总览README.md)。

## 开发

要求：Node ≥ 20，pnpm ≥ 10。

```sh
pnpm install
pnpm build        # tsc -> lib/
pnpm test         # node:test（离线，零 API 依赖）
pnpm lint         # tsc --noEmit
```

## 本地安装验证（M0 演示回路）

在**本仓库的父目录**执行（相对路径写法参照官方发布教程）：

```sh
dsh plugin --profile web add ./dsh-pipeline   # link 安装进 profile
dsh --profile web --dump-config               # 应可见 "# == dsh-pipeline" 层
dsh --profile web                             # 启动；apply 日志含工具注册与自检结果
dsh plugin --profile web remove dsh-pipeline  # 卸载：层消失、工具随 effect 注销
```

M0 的 hello 工具（`pipeline_hello`）在插件 apply 时会通过
`ctx.tools.execute` 自检一次（官方教程第 7 章模式，无需模型 API key），
日志即注册与执行证据。

## License

[MIT](./LICENSE)
