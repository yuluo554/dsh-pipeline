# data/ —— fixtures 与快照真值（plan/04）

> 全部 fixture 均为本项目自制，无外部来源。快照文件由首版编译器生成后**人工审定冻结**；
> 改动序列化格式 = 口径变更（HANDOFF 口径 2），必须先过 plan/06 决策记录再重冻结。

## pipelines/ —— 合法定义（B1 输入）

| 文件 | 用途 | 覆盖特性 |
|---|---|---|
| `single-node.json` | 最小用例 | 1 节点 1 prompt，默认父路由 |
| `three-node-two-models.json` | **M1 演示原型** | 大纲(cheap)→复查(默认)→成文(reasoner)；跨节点模板注入 |
| `multi-prompt-node.json` | 节点内多条 prompt | 3 条 prompt 顺序投递，`{{prev}}` 链 |
| `depends-explicit.json` | 显式依赖 | `dependsOn: []` 覆盖隐式串接（口径 1）、DAG 汇聚 |
| `output-schema.json` | 结构化输出 | outputSchema 节点 + 下游 JSON 安全插值 |

**M2 待增**：`skills-and-tools.json`（skills 注入 + tools.deny）、`retry-skip.json`（retry:n + skip 策略）
—— 这两份的特性（FR-10/11/9）按 plan/06 排期 M2 落地，M1 编译器对相应字段显式拒绝（`IR_UNSUPPORTED_FEATURE`）。

## invalid/ —— 非法定义（B2 输入）

期望错误码登记在 `invalid/index.json`（fixture 本身非法，无法内嵌元数据，故用 sidecar 清单）。
码表：`SCHEMA_INVALID`（形状）/ `IR_DUPLICATE_ID` / `IR_RESERVED_ID` / `IR_UNKNOWN_DEPENDENCY` /
`IR_SELF_DEPENDENCY` / `IR_DEPENDENCY_CYCLE` / `IR_UNKNOWN_VARIABLE`（含畸形表达式、首 prompt 的
`{{prev}}`）/ `IR_OUTPUT_SCHEMA`（超出引擎 schema 子集）/ `IR_UNSUPPORTED_FEATURE`（M2 特性闸门）。

`m2-*.json` 前缀 = 形状合法（validateDef 通过）但 M1 语义闸门拒绝的用例，验证"拒绝点在 IR 层且报错可读"。

## snapshots/ —— 编译快照真值（B1 判据）

- `<name>.js` = 对应 `pipelines/<name>.json` 的期望脚本字符串，**逐字节比对，0 diff**。
- 生成方式：`scripts/freeze-snapshots.js`（compile → 写盘），生成于编译器 0.1.0（dsh 0.1.5-rc.1 锚定）。
- 审定记录：首版生成后对照 dsh-workflow-worker-thread 0.1.5-rc.1 的 `agent()` 语义逐字段核对
  （label/provider/model/schema 选项、null 失败语义、phase/log/args 全局变量），人工确认后冻结。
- 改快照格式前先读 plan/04「真值语义」与 HANDOFF 口径 2。

## 真值语义备忘（与 plan/04 同步）

- mock engine 断言对象 = `agent()` 调用参数序列（label/prompt/opts 快照），非模型输出。
- 互斥坑登记：① 显式 `dependsOn` 覆盖隐式串接；② 引用 skip 策略节点输出 = 编译期拒绝（M2 随 skip 落地启用）。
