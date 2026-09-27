# M1 演示留档（2026-09-27）

> M1 DoD：B1-B3 全绿；演示日志留档；回写 plan/00、06，写 HANDOFF-M2。
> 本机无模型 API key（plan/06 偏差 #1），演示分两层：**离线全链路**（mock engine，
> 零 API 依赖、可重复）+ **实机装载冒烟**（真实 dsh 0.1.5-rc.1 web profile）。
> 在线冒烟（真实 DeepSeek API 跑 three-node-two-models）= 人工门，待有 key 后补做。

## 1. 基准全绿（pnpm bench，零 API 依赖）

```text
dsh-pipeline offline benchmarks (plan/04) — zero API dependency
================================================================
B1 compile snapshots : 5/5 byte-exact   (threshold: 5/5, 0 diff)
B2 validation matrix : 23/23 expected outcomes (threshold: 100%)
B3 mock engine e2e   : 4/4 scenarios matched (threshold: exact)
================================================================
ALL GREEN
```

离线测试（node:test）：**49/49 pass**（`pnpm test`，含 B1/B2/B3 基准断言、
schema/ir/runner/store/entry 单测、M0 插件契约回归）。

## 2. three-node-two-models 离线全链路演示（大纲 → 复查 → 成文，双模型各自生效）

编译产物（B1 快照真值之一，逐字节冻结）：

```js
// dsh-pipeline 0.1.0 — compiled pipeline "three-node-two-models".
// 3 nodes, 3 agent calls; failure policy: abort (M1).
const out = {};
phase("Outline");
{
  const __p1 = await agent("Write a concise bullet-list outline for a short article about " + args + ". Return only the outline.", {
    label: "Outline",
    provider: "deepseek",
    model: "deepseek-chat",
  });
  if (__p1 === null) throw new Error("node \"outline\" failed at prompt 1");
  out["outline"] = __p1;
}
phase("Review");
{ /* … review prompt 注入 out["outline"]，默认父路由 … */ }
phase("Write");
{ /* … write prompt 注入 out["outline"] + out["review"]，model: deepseek-reasoner … */ }
return { nodes: out };
```

agent() 调用 trace（mock engine 按 label 脚本化响应；断言对象 = 调用参数序列，口径 3）：

```text
#1 [Outline] label="Outline" opts={"label":"Outline","provider":"deepseek","model":"deepseek-chat"}
   prompt: "Write a concise bullet-list outline for a short article about introduce the dsh-pipeline plugin. …"
#2 [Review] label="Review" opts={"label":"Review"}
   prompt: "Review the following outline …\n\nOutline:\n1. What is dsh-pipeline  2. Why multi-node …"   ← 上游输出已注入
#3 [Write] label="Write" opts={"label":"Write","provider":"deepseek","model":"deepseek-reasoner"}
   prompt: "Write the final short article about … using this outline:\n1. What is dsh-pipeline …\n\nApply these review notes:…"  ← 双上游注入
```

事件序（与真实引擎 workflow/* 语义一致）：

```text
workflow:start
phase:Outline  → agent-start:1:Outline → agent-end:1:Outline:completed
phase:Review   → agent-start:2:Review  → agent-end:2:Review:completed
phase:Write    → agent-start:3:Write   → agent-end:3:Write:completed
workflow:end:completed
```

结果：`stopReason=completed, agentsStarted=3, value={nodes:{outline,review,write}}`。
取消注入（cancelAfterCalls:1）→ 恰好 1 次调用无残留、`workflow:end:cancelled`；
失败注入（failAtCalls:2）→ `workflow:end:error` 且错误信息 `node "planner" failed at prompt 2`。

## 3. 实机装载冒烟（dsh 0.1.5-rc.1，web profile）

```text
$ dsh --profile web --dump-config | grep -A4 workflow-worker-thread
# == @deepseek-ai/dsh-base, patched by @deepseek-ai/dsh-web-app, dsh-pipeline
- id: workflow-worker-thread
  name: '@deepseek-ai/dsh-workflow-worker-thread'
  config:
    provider: spawn
  disabled: false                     ← bundle patch 启用引擎（见 plan/06 决策）

$ dsh --profile web --no-open --port 0   # 启动即加载插件
[dsh-pipeline] tool registered: pipeline_hello
[dsh-pipeline] 0.1.0 entry registered: /pipeline command + pipeline tool
[dsh-pipeline] self-test replied: [{"type":"text","text":"Hello, dsh-pipeline! (dsh-pipeline)"}]
dsh web: http://127.0.0.1:…/?token=…   （token 已脱敏）
```

无 `did not activate`、无 error —— 注入面（tools/workflowEngine/subagents/commands/fs）
在宿主根上下文全部就绪，`/pipeline` 命令与 `pipeline` 工具完成实机注册。

## 4. 待办（人工门）

- [ ] 在线冒烟：配置 `DEEPSEEK_API_KEY` 后，web UI 中 `/pipeline run three-node-two-models <主题>`，
      人工核对双模型产出差异；每次 dsh rc 升级后必跑（plan/04）。
