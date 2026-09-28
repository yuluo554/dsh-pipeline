# M2 演示留档(m2-demo-log.md,2026-09-27)

> M2 DoD:① 注入坏节点三种策略各演示一次;② 取消演示。全部离线、零 API 依赖;
> 在线冒烟仍待 `DEEPSEEK_API_KEY`(沿袭 plan/06 M1 偏差 #1,补做点不变)。

## 1. 基准指标(`pnpm bench`,dsh 0.1.5-rc.1 锚定)

```
dsh-pipeline offline benchmarks (plan/04) — zero API dependency
================================================================
B1 compile snapshots : 7/7 byte-exact   (threshold: 7/7, 0 diff)
B2 validation matrix : 22/22 expected outcomes (threshold: 100%)
B3 mock engine e2e   : 4/4 scenarios matched (threshold: exact)
B4 policy matrix     : 6/6 scenarios matched (threshold: exact)
================================================================
ALL GREEN
```

测试:`pnpm test` = **59/59 通过**(M1 为 49;+B4 断言、策略/skip 引用专项断言、真实引擎 4 例)。

## 2. 策略演示(mock engine,完整 trace;复现 = `pnpm bench` 的 B4 + test/real-engine.test.js)

注入坏节点 = 行为脚本 `failAtCalls` 指定第 N 次 `agent()` 调用失败(子 agent 返回 null,
即真实引擎语义)。fixture = `retry-skip.json`(fetch=skip:2 / enrich=skip / report=abort /
verify=abort:1)与 `multi-prompt-node.json`。完整演示输出(会话工作稿演示脚本一次运行的原始记录):

```text
### abort — planner #2 fails (default policy)
events  : workflow:start  phase:Planner  agent-start:1:Planner #1  agent-end:1:Planner #1:completed  agent-start:2:Planner #2  agent-end:2:Planner #2:failed  workflow:end:error
outcome : stopReason=error agentsStarted=2 error="node "planner" failed at prompt 2"
nodes   : null

### skip — enrich fails once (failurePolicy=skip)
events  : workflow:start  phase:Fetch  agent-start:1:Fetch  agent-end:1:Fetch:completed  phase:Enrich  agent-start:2:Enrich  agent-end:2:Enrich:failed  phase:Report  agent-start:3:Report  agent-end:3:Report:completed  phase:Verify  agent-start:4:Verify  agent-end:4:Verify:completed  workflow:end:completed
outcome : stopReason=completed agentsStarted=4
nodes   : {"fetch":"mock output 1","enrich":null,"report":"mock output 3","verify":"mock output 4"}

### retry — fetch fails once, attempt 2 succeeds (retry=2, policy=skip)
events  : workflow:start  phase:Fetch  agent-start:1:Fetch  agent-end:1:Fetch:failed  agent-start:2:Fetch  agent-end:2:Fetch:completed  phase:Enrich  agent-start:3:Enrich  agent-end:3:Enrich:completed  phase:Report  agent-start:4:Report  agent-end:4:Report:completed  phase:Verify  agent-start:5:Verify  agent-end:5:Verify:completed  workflow:end:completed
outcome : stopReason=completed agentsStarted=5
nodes   : {"fetch":"mock output 2","enrich":"mock output 3","report":"mock output 4","verify":"mock output 5"}

### retry exhausted + abort — fetch fails all 3 attempts
events  : workflow:start  phase:Fetch  agent-start:1:Fetch  agent-end:1:Fetch:failed  agent-start:2:Fetch  agent-end:2:Fetch:failed  agent-start:3:Fetch  agent-end:3:Fetch:failed  workflow:end:error
outcome : stopReason=error agentsStarted=3 error="node "fetch" failed at prompt 1 after 3 attempt(s)"
nodes   : null

### cancel — real dsh-workflow-worker-thread engine, abort mid-child
children: 2 started, child #2 signalAborted=true
outcome : stopReason=cancelled agentsStarted=2 error="workflow run cancelled: workflow signal aborted"
```

要点复述:

1. **abort(默认策略)** — planner #2 失败 → 运行即止,`workflow:end:error`。
2. **skip** — enrich 失败一次 → `out["enrich"]=null`,下游 Report/Verify 照跑,整体 completed。
3. **retry(节点级循环重跑)** — fetch 首试失败、第二次成功(agentsStarted=5),全链 completed。
4. **retry 耗尽 + abort 收场** — fetch 三试全败(策略覆写为 abort):
   error=`node "fetch" failed at prompt 1 after 3 attempt(s)`。
   (skip 收场的对称场景 = B4 场景 4:三试全败 → `out["fetch"]=null`,运行 completed 继续。)

## 3. 取消演示(真实引擎 `@deepseek-ai/dsh-workflow-worker-thread` 0.1.5-rc.1)

真实 worker 线程 + vm + ChildStart/Settled RPC 全链,子 agent 为桩 provider(长任务子进程
语义:仅在被中止时结算)。两条取消通路各验一次:

- **run.cancel()**(引擎级):第 2 个受管子 agent 在飞时 `run.cancel('…')` →
  `stopReason=cancelled`,该子 agent 的共享 signal `aborted=true`,无后续子 agent 启动,
  `run.dispose()` 干净结算(test/real-engine.test.js 场景 2)。
- **输入 AbortSignal**(runner 级,FR-8):`controller.abort()` → runner 映射为引擎取消 →
  `stopReason=cancelled`,子 agent 观察到中止并恰好 dispose 一次(场景 3)。
- 演示脚本输出:`children: 2 started, child #2 signalAborted=true`,
  `outcome : stopReason=cancelled agentsStarted=2 error="workflow run cancelled: workflow signal aborted"`。
- 重试循环中的取消不会失控:取消以 CANCELLED **抛出**的形式打断脚本(策略只治理 null),
  B4 场景 6 验证 `agentsStarted=1` 后干净 cancelled。

## 4. 实机装载冒烟(dsh web profile,lib 0.2.0)

后台 `dsh --profile web --no-open --port 0` 启动日志(去 AGENTS 存档):

```
[dsh-pipeline] tool registered: pipeline_hello
[dsh-pipeline] 0.2.0 entry registered: /pipeline command + pipeline tool
[dsh-pipeline] self-test replied: [{"type":"text","text":"Hello, dsh-pipeline! (dsh-pipeline)"}]
```

- `did not activate` 计数 = **0**(引擎 inject 正常挂载)。
- `--dump-config`:`workflow-worker-thread` 层 `disabled: false`(dsh-pipeline patch 生效),
  官方 `tool-workflow` 保持禁用不动。

## 5. 在线冒烟(人工门,待 key)

沿袭 M1:配置 `DEEPSEEK_API_KEY` 后跑 `three-node-two-models.json` 人工核对
(plan/04 在线冒烟口径,M0/M1/M2 三代欠账一并补)。
