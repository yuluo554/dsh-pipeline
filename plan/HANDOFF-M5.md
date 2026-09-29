# HANDOFF —— 跨会话交接快照（M5 起续接）

> 填写纪律：只写实测过的内容；环境坑必须带复现与解法；敏感字面值用占位符。

## 当前进度

- 里程碑：M4（已完成于 2026-09-29）→ **0.2.0-rc.1 适配（完成于 2026-09-29，第六个提交 2c6cf4c）**
- 工作区：`D:\ProgramData\zcode\dsh-1\dsh-pipeline`；git：本地 `main` 无远端
- 本机 dsh 已升级 **0.1.5-rc.1 → 0.2.0-rc.1**（npm `next` 标签；`latest` 仍指 0.1.7-rc.2；
  0.2.0-rc.1 发布于 2026-09-28，tag dsh-v0.2.0-rc.1）
- **0.2.0 破坏性变更（已适配）**：官方 workflow 引擎换血——`dsh-workflow-worker-thread`
  （0.1.5-rc.3 后不再发布）→ `@deepseek-ai/dsh-workflow-ptc`（共享沙箱 Node PTC 运行时里的
  vm realm；guest 以 data: URL 模块在受限进程执行，跨 realm 仅许无损 JSON）。适配面：
  - bundle patch 行 `workflow-worker-thread` → `workflow-ptc`（web profile 仍默认 disabled: true，
    覆盖位翻转即可；`tool-workflow` 保持禁用不变）
  - 依赖 pin 全量 0.1.5-rc.1 → 0.2.0-rc.1（cordis 4.0.2 → 4.0.4）；devDep 换 `dsh-workflow-ptc`
  - **seam 词汇零变化**（实测 tsc 一次过）：`WorkflowStartRequest`/`WorkflowRun`/`WorkflowResult`/
    `WorkflowAgentInfo` 等全兼容；`workflow/*` 事件名与负载不变（run-recorder/run-events 无需改）；
    runner 已传 `meta`（0.2.0 起必填且强校验——恰好早已满足）；agent() 选项仍只许
    label/phase/schema/provider/model（effort/isolation/agentType 仍大声拒绝 → FR-11 闸门维持）
  - 真实引擎测试重写：PtcWorkflowEngine + 桩 ptcRuntime（从引擎 program 串抽出 guest 的
    data: URL 进程内直跑真实 guest）+ 桩 sandboxPolicy；**桩 subagents 的 run 必须带 `id`**
    （0.2.0 guest 把 run.id 写进 agent-start 负载 childId）；PTC config 无 disposeGraceMs
- 演示证据：`plan/m4-demo-log.md`（M4）；0.2.0 适配实机留证 = 0 did-not-activate +
  组合树 `workflow-ptc` enabled + inventory 200 过认证栅栏 + bundle 在启动图 combo 服务（452KB 组）
- 测试：99/99 全绿；B1-B4 ALL GREEN（0.2.0-rc.1 类型下 pnpm lint 一次过）

## 下一里程碑待办（plan/05 M5，发布）—— 2026-09-29 执行后状态

- [x] 【串行】README 完整化（简介/特性/mermaid 架构/快速开始/评测表/限制/免责/已知环境问题）+ LICENSE 已在（7cf05ab；兼容 floor 同步提升 `>=0.2.0-rc.1`，plan/06 决策行）
- [x] 【串行】**干净环境验证**：隔离 store 全新 clone 按 README 逐条跑通 + 实机回路；**发现 #1 Windows clone CRLF 挂 B1 → .gitattributes eol=lf + EOL 守门测试**（459733d）；发布后 GitHub 全新 clone 复核 101/101
- [x] 【串行】脱敏四步 + 历史三扫（留档 plan/RELEASE-M5.md；**审查固化为 scripts/release-audit.mjs + 守门测试随全量测试跑**，fbdaa3c；全历史 0 命中，首推前执行）
- [ ] 【并行】npm 发包（预构建 lib/；pack 预检 74 文件无泄漏已过）→ **阻塞：本机未登录 npm（ENEEDAUTH），用户动作**（命令见 RELEASE-M5 §3）
  - [x] 仓库打 `dsh-plugin` topic（+workflow/orchestration/agent/pipeline，已回读确认）
  - [ ] awesome-dsh-plugin PR（标注回应 #7704）——待发包，文案草稿 RELEASE-M5 §4
  - [ ] #7704 回帖——待发包，草稿同上
  - [ ] dsh-market 提交——收录 awesome 全量，awesome 入列即覆盖
- **演示物**：GitHub 公开可访问 ✅（**https://github.com/yuluo554/dsh-pipeline**，12 提交，CI 首跑 28s 绿；HTTPS 推送因 OAuth 缺 workflow scope 被拒 → 切 SSH 一次过，坑记 RELEASE-M5 §5）；npm 可 `dsh plugin add` ⬜ 待发包复核
- **DoD**：plan/00 验收门全部打勾 ✅（npm 相关两项随发包闭环）；发布后复核 ✅
- 测试现状：**101/101**（99 + EOL 守门 + 脱敏守门）；B1-B4 ALL GREEN；远端 = origin（SSH）yuluo554/dsh-pipeline

## 人工门清单（多代合并欠账；M5 顺手补或明示弃线）

- [ ] **浏览器 GUI 冒烟**（M3 偏差 #2 + M4 偏差 #1 同根因）：本机 CDP 启动损坏（环境坑 #1），
  换环境/手工浏览器验证：① M3 项——设置 → 流水线区渲染、会话头"流水线"按钮 → 弹窗 → 选流水线运行；
  ② M4 项——会话流内运行卡实时渲染（节点状态点/耗时/token/双模型对比徽章/错误行）
- [ ] **在线冒烟**（M0/M1/M2/M3/M4 五代合并欠账）：`DEEPSEEK_API_KEY` 配置后按 plan/04 口径人工跑
  `three-node-two-models.json`；M4 增补两条——① 运行页发起 → 会话流观察卡片状态流转；
  ② 卡片耗时/token 与会话统计交叉核对
- [ ] skills 在线验证（M2 顺延）：真实 `ctx.skills`（skill-filesystem）链路 + 编辑器技能多选真实数据展示
- [x] dsh 升级决策（M2/M3/M4 连续顺延；**2026-09-29 用户确认升级，已完成**）：本机 dsh 0.2.0-rc.1
  （见"当前进度"）。0.2.0 引擎（PTC）仍无 toolFilter，effort/isolation/agentType 仍拒 →
  **FR-11 闸门维持**，编辑器三个只读字段继续只读；依赖锚定已重锚 0.2.0-rc.1 + 全量重核（tsc/99 例/基准）

## 既定口径清单（M4 期末冻结；动了会打挂基准——改前对照，改后重跑 B1-B4）

1. IR/编译器/runner 全部 M2 口径原样未动（见 HANDOFF-M3 清单 1-8 + HANDOFF-M4 清单 1-8，
   此处不重复）；M4 对 runner 的唯一增量为可选 `onRunStart` 钩子（engine.start 同步返回后调用，
   不触任何冻结语义）；B1-B4 重跑 ALL GREEN
2. **装配字段序冻结**（M3）：schema.validateNode 与 form-model.nodeFromForm 按 schema 文档字段序
   装配（spread 保序，禁止事后赋值重排）；store.saveDef 落盘字节 = `JSON.stringify(def,null,2)+'\n'`
3. **form-model 双向等价语义**（M3）：往返深等 + 退化空对象归一；hasExplicitDeps 保留；
   闸门字段编辑器只读、round-trip 无损
4. **client bundle 契约**：`window.__ModuleLoader__.load({id,factory})` 懒 CJS；external 白名单 =
   平台种子表 + dsh.client.external（现仅 locale 包）；**新增浏览器运行时依赖必须三处同步**
   （package.json dsh.client.external+inject、build-client.mjs SEED_MODULES、client/ambient.d.ts
   类型 import）；M4 未新增运行时依赖（渲染器 react + 内联样式）
5. **web API 面冻结**：/api/dsh-pipeline/{inventory,def,validate,save,catalog,run}；统一 `{error}`
   4xx/5xx + 业务结果 200；run 请求体 {name,input,sessionId}，request.signal 即取消通路
6. **依赖锚定 0.2.0-rc.1 修订**（口径 7 扩容至 15）：原 13 + `@deepseek-ai/dsh-client-ui-chat`
   （type-only：ChatNodeDataMap 合并 + ChatNode<'pipeline-run'> 键型）；**版本全量
   0.2.0-rc.1 + cordis 4.0.4**（0.1.5-rc.1/cordis 4.0.2 时代口径作废）；全部 type-only/d.ts 消费；
   devDep 另加 esbuild/react(仅测试)/@types/react + `dsh-workflow-ptc`（真实引擎测试）
7. **浏览器侧类型纪律**：席位键一律经官方包 d.ts 声明合并（ambient.d.ts 现含 5 个
   `import type {}`，新增 dsh-client-ui-chat/client）；**用户空间 `declare module
   '@deepseek-ai/cordis'` 禁用**；client tsconfig lib 必须含 ESNext
8. **运行卡事件契约（M4 新增）**：
   - 通路 = 父会话持久日志 `session.append` 自定义事件，**不走 api-remotes**（实测
     `API_REMOTE_FORWARDED_EVENTS` 白名单不含 `workflow/*`，emit 模式要求 JSON 参数）
   - 词汇 = `pipeline-run/run-start|agent-start|agent-end|run-end`，接口+折叠+投影**单源
     `src/run-events.ts`**（宿主 lib/ 编译、client bundle esbuild 内联、Node 测试三方同源）；
     `SessionEventMap` 插件声明合并扩展（官方 tool-workflow 同款）
   - recorder = 每运行一实例（web 半 runFromWeb 内创建），监听 `workflow/agent-start|end`
     + `session/event` firehose，append 失败即停用该运行记录且**绝不影响运行结果**（官方同款守则）；
     零 instanceof（跨副本坑纪律）
   - 聚合口径：耗时 = 宿主时钟 receipt-to-receipt；token = firehose 按 childId 累计子会话
     `assistant/message` usage，agent-end 定稿，空合计省略 usage 字段；成本徽章按声明路由
     `provider|model` 分组（**含失败尝试的真实开销**）；节点状态 = 末次 agent 调用 outcome 定节点
   - 已知限制（决策行记录不修）：web 发起的 run-start 无宿主 turn/step → location unresolved →
     locationClosed 启发式永不触发 → 宿主崩溃的运行卡停留 running；M5 候选改进 = recorder 心跳
9. 测试全离线（含真实 Session 集成与真实引擎用例）；在线冒烟仅人工门；M0 自检行为保留

## 本机环境坑（M4 新增实证；只写实测过的）

1. **浏览器自动化损坏（延续未解决）**：M4 未再试（HANDOFF-M4 坑 #1 判定机器级，勿按同路径重试）；
   GUI 人工门继续换手工浏览器/另寻环境
2. **Node 进程随机原生崩溃（实测两形态）**：① V8 `Fatal error ... unreachable code`
   （Promise::MarkAsSilent 栈）；② 构建/测试期 exit 3221225477（0xC0000005）。同一命令重试即过
   （M4 各复现 1 次、重试 1 次全绿）；判别口径 = 崩溃无业务输出≠测试失败，重试后再定性
   （crash-loop-rescue skill 口径）
3. **Git Bash 下 powershell 内联命令的 `$_` 会被 bash 展开**（展开成 bash 的上一参数/启动脚本路径，
   powershell 报语法错）：powershell -Command 一律用**单引号**包裹整条命令
4. 沿袭 M3：插件与宿主各解析一份 npm 包副本（instanceof 跨接缝失效，按 code/字段判别）；
   dsh-client-ui-slots 在 profile 的符号链接悬空（读类型用仓库 pnpm 副本）；web profile 引擎默认
   禁用（patch 已兜，0.2.0 引擎 id = `workflow-ptc`）；`dsh --help` 验装捷径失效；
   后台 dsh 清理用 powershell Get-CimInstance 按 CommandLine 匹配（注意坑 3 的引号）或
   netstat -ano 查 LISTENING PID 后 taskkill；`python` 是商店 stub
5. **npm 全局安装段错误（0.2.0 适配实测）**：Git Bash 下 `npm i -g` 连续段错误（npm 包装脚本
   `"$NODE_EXE" "$NPM_CLI_JS"` 处崩）；绕法 = 直接 `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" i -g <pkg>`（一次过）。判别口径照 crash-loop-rescue：同命令重试 ≤3 次即换通道
6. **0.2.0-rc.1 包集合变化（适配实录）**：`dsh-workflow-worker-thread` 停更于 0.1.5-rc.3（0.2.0 不再
   发布）；新增 `dsh-workflow-ptc` + `dsh-ptc-runtime`(+node)；release notes 唯一结构性变化 = 自动化
   任务改为可选插件包；引擎 config = {provider:'spawn', maxConcurrentAgents(0=自动),
   maxTotalAgents, maxItemsPerCall, syncTimeoutMs}（无 disposeGraceMs）；engine.start 的 meta
   必填强校验（META_INVALID 逐字段报错）；client bundle 在启动图以 combo URL 服务
   （`/plugins/??<id>/client.js,…&rev=<rev>`，rev 从外壳 HTML 取，手拼 rev 404）
5. **会话恢复语义（非坑，实测备忘）**：`Session.create(id, seedEvents)` 走 replay/fork 路径，
   会在继承前缀切点补一条 `session/end-seed`（无 `{inherited:true}` 标签，data 为 `{}`），
   故重建后 `seq = 原长 + 1`；"fresh fork child" 才带 `inherited: true`
7. **shell cwd 漂移事故（M5 实录，RELEASE-M5 §5）**：验证用的 clone 会话会把后续命令的 cwd
   停在 clone 里——`git add -A && commit && push` 曾在复核 clone 内执行，把隔离 pnpm store
   推上远端（CI 守门拦截，force push 回滚）。纪律：**git 操作前显式 cd 目标仓库并核对
   `git log -1` + `git remote -v`**；pnpm store 目录（.clean-store/.verify-store/.pnpm-store）
   已进 .gitignore

## M4 DoD 逐项 checklist（来自 plan/05，全部留痕）

- [x] 【串行】`pipeline-run` ConversationNodeDefinition（keyed renderer，订阅 `pipeline-run/*`
  会话事件；`workflow/*` 不经 api-remotes——通路决策见 plan/06 M4 行）
- [x] 【串行】每节点耗时/token 聚合（宿主时钟时间差 + session/event firehose 子会话 usage 累计）
- [x] 【并行】运行入口页 → 运行卡接线：POST /run 返回摘要保留，运行卡负责会话流内实时状态
  （recorder 在 runFromWeb 接线；RunAction 增加运行中卡片提示行）
- [x] DoD：事件断连/重连后卡片不脏渲染（结构保证：纯 node.data 渲染 + 持久日志重放纯折叠；
  M4 偏差 #2 留证口径）
- [x] 回写 plan/00、06 + README 状态行 + 本 HANDOFF
- [ ] 浏览器 GUI 级验证（环境损坏，人工门清单合并项）

## 关键命令速查

```sh
# 安装到本地 dsh（在仓库父目录 dsh-1/ 执行；开发回路）
dsh plugin --profile web add ./dsh-pipeline
dsh --profile web --dump-config          # 验证层挂载 + 引擎已启用（grep workflow-ptc）
dsh --profile web --no-open --port 3095  # 后台启动；apply 日志 = 装载证据（约 13 秒）
dsh plugin --profile web remove dsh-pipeline

# 基准与测试
pnpm install && pnpm build && pnpm test  # 离线测试（99 例：B1-B4 + 真实引擎 + 真实 Session + form-model/web/client-bundle）
pnpm bench                               # B1-B4 指标表（ALL GREEN 门槛）
pnpm lint                                # host + client 双 tsconfig
node scripts/build-client.mjs            # 仅重建浏览器 bundle（build 已含）

# 实机 API 冒烟（token 从启动日志取；GET /?token=… 303 换 cookie 后携带）
# GET  /api/dsh-pipeline/inventory
# GET  /api/dsh-pipeline/def?name=<n>
# POST /api/dsh-pipeline/validate | /save   （body = 定义 JSON）
# GET  /api/dsh-pipeline/catalog
# POST /api/dsh-pipeline/run               （body = {name,input,sessionId}；运行中会话日志追加 pipeline-run/*）

# M5 发布门速查（plan/05 逐条执行留档 → plan/RELEASE-M5.md）
git ls-files | grep -iE "\.env$|\.key$|secret|token"   # 应为空
```
