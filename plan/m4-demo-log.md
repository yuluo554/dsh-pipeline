# M4 演示证据 —— 运行视图 + 成本徽章（2026-09-29）

> 演示物口径（plan/05）：聊天中实时看到节点状态流转；双模型成本对比徽章。
> 环境事实：本机浏览器自动化损坏（HANDOFF-M4 环境坑 #1，M3 偏差 #2 延续）+
> `DEEPSEEK_API_KEY` 未配置（M0-M3 四代合并欠账），因此「会话流内实时画面」
> 以四层替代证据留档（决策行见 plan/06 M4 段），GUI 人工门合并至 HANDOFF-M5 清单。

## 1. 离线全绿门（口径未动对照：runner 仅加可选钩子，冻结面零改动）

```
pnpm test  → 99/99（新增 run-events 7 例 / run-recorder 6 例 / web recorder 3 例 /
             session-integration 1 例 / bundle 冒烟扩容至三席位+定义折叠）
pnpm lint  → host + client 双 tsconfig 全绿（client 含新增 src/run-events.ts 共享面）
pnpm bench → B1 7/7 byte-exact · B2 22/22 · B3 4/4 · B4 6/6 = ALL GREEN
```

B1-B4 的重跑意义：runner 签名扩容（`onRunStart?`）与 web 半接线均不触编译器/IR/schema
冻结口径，7 份快照逐字节复现 = 口径 2 未动的直接证据。

## 2. 折叠与投影纯函数（状态流转 + 成本聚合的语义真值，test/run-events.test.js）

- 计划链渲染：run-start 携带 IR 节点链（id/label/声明路由），未开始的节点渲染 pending 行
- 末次调用定节点（seq 最大成员）：retry 恢复 `[failed, completed] → completed`、
  多 prompt 中途失败 `[completed, failed] → failed`、skip `[failed] → failed`
- 运行态：成员未结算 → running；run-end 映射 `completed/cancelled/error→failed`
- interrupted 镜像官方 locationClosed 启发式（成员无结算 → interrupted）
- 成本徽章聚合：按声明路由 `provider|model` 分组 calls/duration/tokens，
  **失败尝试计入真实开销**（复查节点 failed 500ms + 成功 900ms = 1400ms，usage 450/70）
- usage 空桶省略语义（sumUsage：从未上报的桶不出现，不渲染 0）

## 3. 宿主 recorder（test/run-recorder.test.js + web.test.js 新增 3 例）

- 事件序：`run-start → agent-start → agent-end → … → run-end`，字段逐一断言
  （runId 配对、phase/模型路由来自计划链、durationMs ≥ 0、usage 求和 110/45/total 140）
- 跨副本安全：零 instanceof（HANDOFF 坑 2 纪律），append 抛错 → 该运行记录停用 +
  logger.warn，**运行结果不受影响**（`a session whose append fails never breaks the run`）
- 监听器生命周期：recorder 每运行一实例，dispose 后全部 handler 摘除（hostHandlers.size = 0）
- web 全链：POST /run → 会话日志出现 run-start（name/nodes/startedAt）+ run-end
  （stopReason=completed, durationMs）；引擎失败路径 run-end.error 指名失败 prompt

## 4. 真实 Session 集成（test/session-integration.test.js，卸载兼容留证）

`@deepseek-ai/dsh-session`（宿主同款 0.1.5-rc.1）真实对象：

- recorder 直接驱动真实 `session.append`：四类 `pipeline-run/*` 事件全部通过
  isJsonValue/envelope 冻结/surface 资格校验（`Object.isFrozen(events[0]) === true`）
- 全新读者 `Session.create(id, snapshotEvents())` 重建成功——未知 log-only 事件类型
  不拒绝读日志（读路径 `surfaceOpOf` 对未知类型只禁 surfaceOp）；重建日志 = 原序 +
  `session/end-seed` 切点标记，续追加 `turn/start` 正常
- 意义：插件卸载后旧会话不因本插件事件词汇而不可读（`ignorable` 词汇规则的实测确认）

## 5. 浏览器半离线冒烟（test/client-bundle.test.js 扩容）

- exports.inject = `['slots','locale','uiConversation']`
- 三席位接线：`settings.section`（pipeline）+ `conversation.session.header.actions`
  （pipeline-run）+ `conversation.chat.node`（key: pipeline-run，M4 新席位）
- 定义折叠断言：`match` 四事件识别/无关事件拒绝、`start` 建 state、
  `buildViewNode` 产出 `{kind:'pipeline-run', data:{status:'running', nodes:[pending]}}`
- 字典断言：zh/en 双字典 ≥ 40 键（新增 card.* 14 键 + run.cardHint）

## 6. 实机装载与传输（web profile，后台 `--no-open --port 3095`）

```
[dsh-pipeline] tool registered: pipeline_hello
[dsh-pipeline] 0.2.0 entry registered: /pipeline command + pipeline tool
[dsh-pipeline] self-test replied: [{"type":"text","text":"Hello, dsh-pipeline! (dsh-pipeline)"}]
dsh web: http://127.0.0.1:3095/?token=…
```

- `did not activate` 计数 = **0**（`grep -ci` 实测）；`uiConversation` 服务注入未引入 pending
- 启动图 `__DSH_BOOT__` 含：`"id":"dsh-pipeline","url":"/plugins/??dsh-pipeline/client.js&rev=21dd89435552c82b-48","inject":["@deepseek-ai/dsh-client-locale"],"external":["@deepseek-ai/dsh-client-locale"]}`
- bundle 传输：`GET /plugins/??…` → **200，62,221 bytes**（M3 为 47 KB）；
  内容含 12 处 `pipeline-run`、`conversation.chat.node` ×2、`uiConversation.events.register` ×1
- RPC 活体（cookie 认证后）：
  - `GET /api/dsh-pipeline/inventory` → 真实工作区流水线 + 工具清单（含 pipeline_hello/pipeline）
  - `POST /api/dsh-pipeline/run`（无此会话）→ `{"ok":false,"error":"session has no runnable agent: session \"no-such-session\" not found"}`（record 前置闸，fail-loud 路由活体）
- 冒烟后按 HANDOFF 纪律清理后台进程（powershell Get-CimInstance 按 CommandLine 匹配 ×3 停止）

## 7. 留待人工门（HANDOFF-M5 清单合并项）

- 浏览器 GUI：会话流内运行卡实时渲染（节点状态点/耗时/token/双模型对比徽章）+
  M3 遗留的设置区/会话头按钮（同一损坏根因）
- 在线全链（四代欠账）：`DEEPSEEK_API_KEY` 后按 plan/04 跑 `three-node-two-models.json`，
  增补 M4 路径——运行页发起 → 会话流观察卡片状态流转 → 卡片耗时/token 与
  会话统计交叉核对
