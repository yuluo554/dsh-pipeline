# HANDOFF —— 跨会话交接快照（M2 起续接）

> 填写纪律：只写实测过的内容；环境坑必须带复现与解法；敏感字面值用占位符。

## 当前进度

- 里程碑：M1（已完成于 2026-09-27）
- 工作区：`D:\ProgramData\zcode\dsh-1\dsh-pipeline`
- 上游调研：`D:\ProgramData\zcode\dsh-1\dsh-plugin-research`（07 号可行性报告 + official-docs 存档）
- git 状态：本地仓库分支 `main`，无远端（M5 发布时建）；M0 为首个提交，M1 为第二个提交
- 插件状态：**已 link 安装进本机 web profile 且激活验证通过**（bundle patch 已启用引擎；无需重装，patch 文件热生效——实测改 cordis.patch.yml 后 `--dump-config` 立即反映）
- 演示证据：`plan/m1-demo-log.md`（bench 指标 + 离线全链路 trace + 实机装载日志）

## 下一里程碑待办（plan/05 M2，护栏与失败策略 ★）

- [ ] 【串行】失败策略 abort/skip/retry 进编译器（skip 映射 null 继续但**禁止被引用**——口径 1 的"引用 skip 节点输出 = 拒绝"在此启用；retry = 节点级循环重跑，重试耗尽按策略收场）
- [ ] 【串行】B4 策略矩阵基准（`data/invalid/m2-*.json` 三份闸门用例转为合法 fixture：`data/pipelines/retry-skip.json`、`skills-and-tools.json` 重新入列，生成快照 + 人工审定冻结）
- [ ] 【串行】取消传播实测（B3 场景 3 已覆盖 mock 层；补真实引擎 `run.cancel` + 引擎中止受管子进程路径，plan/05 演示物"运行中取消干净退出"）
- [ ] 【并行】错误信息本地化（locale/en+zh；错误码已集中在 src/errors.ts，文案散在 schema/ir/runner/entry——先集中再翻译）
- [ ] 【并行】skills 路由（FR-10，`ctx.skills` 解析进提示词；编译期注入，IR/快照口径要走决策行）与 tools 路由（FR-11）评估——见下方"待决问题"
- DoD：B1-B4 全绿；演示 = 注入坏节点三种策略各一次 + 取消演示；回写 plan/00、06，写 HANDOFF-M3

## 既定口径清单（M1 冻结；动了会打挂基准——改前对照，改后重跑 B1-B3）

1. IR 规范化规则：显式 `dependsOn` 覆盖隐式串接；模板引用也生成依赖边（引用下游合法，排序拓扑化）；未知/畸形模板变量、`{{prev}}` 于首 prompt、自引用 → 编译期拒绝；Kahn 拓扑 + 定义序并列打破（同输入同输出）
2. 快照序列化格式：2 空格缩进；agent 选项字段序 label→provider→model→schema；节点语句 = 拓扑序；多 prompt 节点 label 追加 ` #k`；头两行注释含版本/节点数/策略（改格式 = plan/06 决策行 + 重冻结）
3. mock engine 接口（`src/mock-engine.ts`）：断言对象 = agent() 调用参数序列 + 事件字符串序（`phase:<t>`、`agent-start:<seq>:<label>`、`agent-end:<seq>:<label>:<outcome>`、`workflow:end:<stopReason>`）；schema 调用返回 JSON.parse 后的结构化值（对齐真实 structured 语义）；单实例单 run
4. 模板变量词表：`{{input}}` / `{{<nodeId>}}`（末条输出；outputSchema 节点被引用时 JSON.stringify 插值）/ `{{prev}}`；节点 id 语法 `/^[A-Za-z0-9][A-Za-z0-9_-]*$/`，`input`/`prev` 保留
5. 能力预检：fail-loud（列受影响节点 + 修复建议），`subagentProvider` 钉死探测与路由为同一 provider；`maxTotalAgents = Σ prompts.length` 精确上界
6. 测试全离线（引擎 mock；在线冒烟仅人工门）；M1 特性闸门（skills/tools/policies/reasoningEffort → `IR_UNSUPPORTED_FEATURE`）在 M2 逐个解封，解封一个重跑一次全量基准
7. 官方子包依赖精确锚定：`@deepseek-ai/cordis 4.0.2`、`@deepseek-ai/dsh-{agent,brand,commands,fs,llm,subagent,tools,workflow} 0.1.5-rc.1`（= 本机 dsh CLI 内置版本）
8. M0 自检行为保留（`pipeline_hello` + apply 内自调一次）；M1 实测不影响激活，开关继续搁置

## 本机环境坑（M1 新增实证；只写实测过的）

- **web profile 默认禁用 workflow 引擎**：`--dump-config` 可见 `workflow-worker-thread` / `tool-workflow` 均 `disabled: true`（web-app 层 patch）。插件 inject `workflowEngine` 会永久 pending，启动日志 `dsh: 1 entry did not activate`。**解法**：bundle patch 按 id 覆盖 `disabled: false`（patch 词汇 = insert + 按 id 字段覆盖，源码 dsh-app-boot `applyPatchList`）；官方 tool-workflow 保持禁用不动。0.1.5-rc.1 的 `dsh --profile web --help` 在插件加载前就退出（stdout 18 行、stderr 空），**HANDOFF-M1 的"--help 验装载"捷径不复现**——实测路径：后台 `dsh --profile web --no-open --port 0` 抓启动日志（约 13 秒出 apply 日志）+ `--dump-config` 验层
- 引擎 `agent()` 仅支持 `label/phase/schema/provider/model`（源码 SUPPORTED_AGENT_OPTIONS；effort/isolation/agentType 显式拒绝，**无 toolFilter 通路**）；子 agent 失败 → 返回 `null`；取消在下一个 hook 边界抛 CANCELLED；`start()` 同步抛 META_INVALID/SCRIPT_PARSE/未知 provider
- pnpm/Node/Git Bash 环境坑沿袭 HANDOFF-M1（裸 `node --test`、npmmirror、`npm view` 别信 latest）；另：Git Bash 下 node -e 里 `/c/...` 路径不可用，需走 bash 工具链

## 待决问题（M2 开工前对齐）

1. **skills 注入的位置**：编译期解析内容进 prompt（快照会含技能文本，需注入器可替换才能离线冻结快照）vs 运行期脚本内不可行（脚本无 fs/服务访问）——倾向编译期 + 注入器作 IR 参数，走 plan/06 决策行
2. **tools 路由的可行性**：0.1.5-rc.1 引擎 agent() 无 toolFilter 通路——除非 dsh 升级到支持版本，FR-11 只能继续闸门拒绝；用户已口头许可升级 dsh（未执行），升级与否 = 新决策行（升级需重锚 9 依赖 + 全量重核 + 重跑基准；0.1.7 引擎若支持 toolFilter 则解封）
3. **在线冒烟欠账**：`DEEPSEEK_API_KEY` 未配置；M1/M0 两代的在线人工门一起补（web UI 里 `/pipeline run three-node-two-models <主题>`）

## M1 DoD 逐项 checklist（来自 plan/05，全部留痕）

- [x] `data/` fixtures + 快照真值冻结（B1：5/5 逐字节；清单与审定记录见 data/README.md；skills-and-tools/retry-skip 两份推迟 M2，见 plan/06 决策）
- [x] schema.ts → ir.ts → compiler.ts，B1/B2 达标（B2：23/23 含 18 份 invalid 全部按冻结码拒绝）
- [x] runner.ts（能力探测 fail-loud + engine.start + 结果映射；provider 钉死探测=路由）
- [x] entry.ts：`/pipeline list|show|run|help` 命令 + `pipeline` 工具（描述含路由引导；每节点输出截 2000 字符）
- [x] B3 mock engine + 用例（4 场景：双模型路由/结构化插值/取消无残留/abort 失败路径）
- [x] 演示物：离线全链路 trace + 实机装载冒烟（plan/m1-demo-log.md；在线冒烟待 key，plan/06 偏差 #1）
- [x] 回写 plan/00、03、06 + README 评测表 + 本 HANDOFF

## 关键命令速查

```sh
# 安装到本地 dsh（在仓库父目录 dsh-1/ 执行；开发回路）
dsh plugin --profile web add ./dsh-pipeline
dsh --profile web --dump-config          # 验证层挂载 + 引擎已启用（grep workflow-worker-thread）
dsh --profile web --no-open --port 0     # 后台启动；apply 日志 = 装载证据（约 13 秒）
dsh plugin --profile web remove dsh-pipeline

# 基准与测试
pnpm install && pnpm build && pnpm test  # 离线测试（含 B1-B3 断言）
pnpm bench                               # B1-B3 指标表（ALL GREEN 门槛）
pnpm lint
node scripts/freeze-snapshots.js         # 重生成快照（须过口径 2 决策行后用）
```
