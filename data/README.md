# data/ —— fixtures 与快照真值（plan/04）

> 全部 fixture 均为本项目自制，无外部来源。快照文件由首版编译器生成后**人工审定冻结**；
> 改动序列化格式 = 口径变更（HANDOFF 口径 2），必须先过 plan/06 决策记录再重冻结。

## pipelines/ —— 合法定义（B1 输入，7 份）

| 文件 | 用途 | 覆盖特性 |
|---|---|---|
| `single-node.json` | 最小用例 | 1 节点 1 prompt，默认父路由 |
| `three-node-two-models.json` | **M1 演示原型** | 大纲(cheap)→复查(默认)→成文(reasoner)；跨节点模板注入 |
| `multi-prompt-node.json` | 节点内多条 prompt | 3 条 prompt 顺序投递，`{{prev}}` 链 |
| `depends-explicit.json` | 显式依赖 | `dependsOn: []` 覆盖隐式串接（口径 1）、DAG 汇聚 |
| `output-schema.json` | 结构化输出 | outputSchema 节点 + 下游 JSON 安全插值 |
| `retry-skip.json` | **M2 策略原型**（B4 输入） | fetch=skip:2 / enrich=skip / report=abort / verify=abort:1；retry 节点级重跑 + 上界公式 |
| `skills-and-tools.json` | skills 注入（M2） | 节点 `skills: ["office"]` 挂技能进 prompt；M2 落地时 tools 路由仍闸门拒绝，tools.deny 场景由 `invalid/m2-tools.json` 继续把守（名字沿用 plan/04 台账） |

skills fixture 的快照含**罐头技能内容**（`src/bench.ts` 的 `CANNED_SKILLS["office"]`，经 dsh-skill
原生 `renderSkillContent` 渲染）——真实运行时由 runner 解析 `ctx.skills`，冻结/基准用罐头保证确定性。

## invalid/ —— 非法定义（B2 输入，15 份）

期望错误码登记在 `invalid/index.json`（fixture 本身非法，无法内嵌元数据，故用 sidecar 清单）。
码表：`SCHEMA_INVALID`（形状）/ `IR_DUPLICATE_ID` / `IR_RESERVED_ID` / `IR_UNKNOWN_DEPENDENCY` /
`IR_SELF_DEPENDENCY` / `IR_DEPENDENCY_CYCLE` / `IR_UNKNOWN_VARIABLE`（含畸形表达式、首 prompt 的
`{{prev}}`）/ `IR_SKIP_REFERENCE`（引用 skip 策略节点输出，M2 新增）/ `IR_OUTPUT_SCHEMA`（超出引擎
schema 子集）/ `IR_UNSUPPORTED_FEATURE`（特性闸门）。

`m2-*.json` 前缀 = 形状合法（validateDef 通过）但语义闸门拒绝的用例，验证"拒绝点在 IR 层且报错可读"。
M2 起只剩两份：`m2-tools.json`（0.1.5-rc.1 引擎无 toolFilter 通路）、`m2-reasoning-effort.json`
（引擎只转发 provider/model）。原 m2-skip-policy / m2-retry / m2-skills / m2-default-policy 四份
随特性解封移除（覆盖面并入 retry-skip.json / skills-and-tools.json / B4）。

## snapshots/ —— 编译快照真值（B1 判据，7 份）

- `<name>.js` = 对应 `pipelines/<name>.json` 的期望脚本字符串，**逐字节比对，0 diff**。
- 生成方式：`scripts/freeze-snapshots.js`（compile → 写盘）。
- 冻结记录：
  - v0.1.0（M1，2026-09-27）：首版 5 份，对照 dsh-workflow-worker-thread 0.1.5-rc.1 的 `agent()`
    语义逐字段核对（label/provider/model/schema 选项、null 失败语义、phase/log/args 全局变量）后冻结。
  - v0.2.0（M2，2026-09-27）：头第二行格式变更为 `N nodes, M agent calls max; policies: <id>=<policy>[:<retry>]…`
    （plan/06 M2 决策行），全部 7 份重生成并重审定——M1 形状（abort+retry=0 的裸块 + 逐 prompt 抛错）逐字节保持，
    新增 skip/retry attempt 循环骨架与技能块前缀两种形状，逐份对照 worker.cjs agent() 语义核对后冻结。
- 改快照格式前先读 plan/04「真值语义」与 HANDOFF 口径 2。

## 真值语义备忘（与 plan/04 同步）

- mock engine 断言对象 = `agent()` 调用参数序列（label/prompt/opts 快照），非模型输出。
- 互斥坑登记：① 显式 `dependsOn` 覆盖隐式串接；② 引用 skip 策略节点输出 = 编译期拒绝
  （`IR_SKIP_REFERENCE`，M2 起生效；`dependsOn` 指向 skip 节点合法——只定序不取值）。
