# HANDOFF —— 跨会话交接快照（M3 起续接）

> 填写纪律：只写实测过的内容；环境坑必须带复现与解法；敏感字面值用占位符。

## 当前进度

- 里程碑：M2（已完成于 2026-09-27）
- 工作区：`D:\ProgramData\zcode\dsh-1\dsh-pipeline`；git：本地 `main` 无远端，M2 为第三个提交
- 上游调研：`D:\ProgramData\zcode\dsh-1\dsh-plugin-research`（07 号可行性报告 + official-docs 存档）
- 插件状态：**0.2.0 已 link 安装进本机 web profile 且激活验证通过**（`did not activate` 计数 0；
  bundle patch 继续启用引擎；lib 重建后重启 dsh 即生效）
- 演示证据：`plan/m2-demo-log.md`（B1-B4 指标 + 三策略/取消 trace + 实机装载日志）

## 下一里程碑待办（plan/05 M3，Web 半编辑器 ★）

- [ ] 【串行】client 半骨架（`dsh.client` 声明 + client 构建 preset）
- [ ] 【串行】store RPC + 列表/表单编辑器（模型下拉读 catalog、技能读 `ctx.skills`、工具读 `ctx.tools`）
- [ ] 【并行】运行入口页（选流水线 + 输入 + 运行）
- DoD：编辑产物 `validateDef` 全过；与手写 JSON 双向一致；回写 plan/00、06，写 HANDOFF-M4

## 既定口径清单（M2 期末冻结；动了会打挂基准——改前对照，改后重跑 B1-B4）

1. IR 规范化规则：显式 `dependsOn` 覆盖隐式串接；模板引用也生成依赖边；未知/畸形模板变量、`{{prev}}` 于首 prompt、自引用 → 编译期拒绝；**模板引用 skip 策略节点 → `IR_SKIP_REFERENCE` 拒绝（dependsOn 指向 skip 节点合法）**；Kahn 拓扑 + 定义序并列打破
2. 快照序列化格式（v0.2.0）：2 空格缩进；agent 选项字段序 label→provider→model→schema（缩进随调用深度参数化）；节点语句 = 拓扑序；多 prompt 节点 label 追加 ` #k`；头第二行 = `N nodes, M agent calls max; policies: <id>=<policy>[:<retry>]…`（拓扑序逐节点）；快照 7 份全部按 v0.2.0 重冻结（data/README 冻结记录）
3. mock engine 接口（`src/mock-engine.ts`）：断言对象 = agent() 调用参数序列 + 事件字符串序；schema 调用返回 JSON.parse 后的结构化值；单实例单 run——**M2 未动**
4. 模板变量词表：`{{input}}` / `{{<nodeId>}}`（outputSchema 节点被引用时 JSON.stringify 插值）/ `{{prev}}`；节点 id 语法不变，`input`/`prev` 保留——**M2 未动**
5. 能力预检：fail-loud（列受影响节点 + 修复建议），`subagentProvider` 钉死探测与路由；**`maxTotalAgents` = Σ prompts.length × (1 + retry)**（M2 修订）
6. 测试全离线（引擎 mock + 真实引擎桩 provider；在线冒烟仅人工门）；M2 解封 failurePolicy/retry/skills/defaultFailurePolicy，闸门仅剩 tools / reasoningEffort / maxAgentsPerNode；解封一个重跑一次全量基准
7. 官方子包依赖精确锚定：cordis 4.0.2 + dsh-{agent,brand,commands,fs,llm,**skill**,subagent,tools,workflow} 0.1.5-rc.1（**新增 dsh-skill = 第 10 个**）+ devDep dsh-workflow-worker-thread 0.1.5-rc.1
8. M0 自检行为保留；错误文案集中 `src/messages.ts`（`%name%` 占位符）+ locale/en+zh `errors` 键，语言 = entry `locale` 旋钮（默认 en）；**编译脚本内嵌失败文案保持英文**（快照数据）

## 本机环境坑（M2 新增实证；只写实测过的）

- **手工构造真实引擎必须传全量 config**：`WorkerThreadWorkflowEngine(ctx, config)` 的 zod 默认值只在 Cordis 插件流程生效；漏 `maxConcurrentAgents` → worker 的 agent 槽位信号量坏死，运行**永不**开始子 agent（静默挂起）。全量 = provider/maxConcurrentAgents/maxTotalAgents/maxItemsPerCall/syncTimeoutMs/disposeGraceMs（见 test/real-engine.test.js）
- 桩 subagents 语义要对齐 worker.cjs 实测：子 run 结算 `{output, stopReason}`；非 completed（如 error）→ agent() 返 null；被中止 → 结算 cancelled 且引擎随后抛 CANCELLED；run.dispose 会被引擎调用恰好一次
- `pnpm view` 确认 `@deepseek-ai/dsh-skill@0.1.5-rc.1`、`@deepseek-ai/dsh-workflow-worker-thread@0.1.5-rc.1` 在 npmmirror 可装
- 沿袭 M1/M0：web profile 引擎默认禁用（patch 已兜）；`dsh --help` 验装捷径失效（用后台 `--no-open --port 0` 抓 apply 日志）；Git Bash 下 node -e 里 `/c/...` 路径不可用；`python` 是 Windows 商店 stub（exit 49 无输出），批处理改 node 脚本
- 后台 dsh 冒烟进程清理：`dsh.exe` 不存在（跑在 node.exe 下），用 powershell `Get-CimInstance` 按 CommandLine 匹配 'dsh' 找 PID 再 Stop-Process

## 待决问题（M3 开工前对齐）

1. **dsh 升级与否**（沿袭 M2 未执行）：0.1.5-rc.1 无 agent() toolFilter 通路 → FR-11 tools 路由维持闸门；用户已口头许可升级（未执行）。升级 = 重锚 10 依赖 + 全量重核 + 重跑基准；0.1.7 引擎若支持 toolFilter 则解封。M3 编辑器要读 `ctx.tools` 列表展示，与路由解封是两件事，不阻塞 M3
2. **在线冒烟欠账**（M0/M1/M2 三代合并）：`DEEPSEEK_API_KEY` 未配置；配置后按 plan/04 口径人工跑 `three-node-two-models.json`
3. **skills 在线验证**：FR-10 已离线落地（罐头内容冻结 + 桩 registry 测试），真实 `ctx.skills`（skill-filesystem）链路待在线冒烟一并人工核对（挂 office 技能节点产出 docx 的验收口径在 plan/01 FR-10）

## M2 DoD 逐项 checklist（来自 plan/05，全部留痕）

- [x] 失败策略 abort/skip/retry 进编译器（skip 禁被引用 `IR_SKIP_REFERENCE`；retry 节点级循环，耗尽按策略收场；B4 6/6）
- [x] B4 策略矩阵基准 + `data/invalid/m2-*` 三份闸门用例转正（retry-skip.json / skills-and-tools.json 入列，快照 v0.2.0 重冻结人工审定；tools/reasoning-effort 闸门保留）
- [x] 取消传播实测：真实引擎 run.cancel + 输入 AbortSignal 两通路 + 受管子进程共享 signal 中止（test/real-engine.test.js 4 例 + 演示 trace）
- [x] 错误信息本地化（locale/en+zh 全目录 + messages.ts 集中 + entry locale 旋钮；EN/ZH 渲染实测）
- [x] skills 路由（FR-10）落地（编译期注入 + ctx.skills 解析 + 罐头冻结）；tools 路由（FR-11）评估完成 = 维持闸门（plan/06 决策行）
- [x] 演示物：注入坏节点三策略各一次 + 取消演示（plan/m2-demo-log.md §2/§3）+ 实机装载冒烟（§4）
- [x] 回写 plan/00、03、04、06 + data/README + README 评测表 + 本 HANDOFF

## 关键命令速查

```sh
# 安装到本地 dsh（在仓库父目录 dsh-1/ 执行；开发回路）
dsh plugin --profile web add ./dsh-pipeline
dsh --profile web --dump-config          # 验证层挂载 + 引擎已启用（grep workflow-worker-thread）
dsh --profile web --no-open --port 0     # 后台启动；apply 日志 = 装载证据（约 13 秒）
dsh plugin --profile web remove dsh-pipeline

# 基准与测试
pnpm install && pnpm build && pnpm test  # 离线测试（含 B1-B4 断言 + 真实引擎测试）
pnpm bench                               # B1-B4 指标表（ALL GREEN 门槛）
pnpm lint
node scripts/freeze-snapshots.js         # 重生成快照（须过口径 2 决策行后用）
```
