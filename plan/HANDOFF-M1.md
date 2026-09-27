# HANDOFF —— 跨会话交接快照（M1 起，每个里程碑收尾填写一份，旧的头部标"已过时仅作历史"）

> 填写纪律：只写实测过的内容；环境坑必须带复现与解法；敏感字面值用占位符。

## 当前进度

- 里程碑：M0（已完成于 2026-09-27）
- 工作区：`D:\ProgramData\zcode\dsh-1\dsh-pipeline`
- 上游调研：`D:\ProgramData\zcode\dsh-1\dsh-plugin-research`（07 号可行性报告 + official-docs 存档）
- git 状态：本地仓库已 init（分支 `main`），无远端（M5 发布时建）；M0 为首个提交
- 插件状态：**已 link 安装进本机 web profile**（`dsh plugin --profile web add ./dsh-pipeline`），bundle 层处于激活态

## 下一里程碑待办（plan/05 M1，★核心）

- [ ] 【串行】`data/` fixtures + 快照真值冻结（plan/04）
- [ ] 【串行】schema.ts → ir.ts → compiler.ts（B1/B2 达标）
- [ ] 【串行】runner.ts（能力探测 + engine.start + 结果映射；能力 flag 探测方式按口径 4）
- [ ] 【串行】entry.ts：`/pipeline` 命令 + `pipeline` 工具
- [ ] 【并行】B3 mock engine 搭建与用例（接口冻结后即可开工，不等 runner 完成）
- 演示物：`three-node-two-models.json` 真实跑通（大纲→复查→成文，两模型各自生效）
- DoD：B1-B3 全绿；演示录屏/日志留档；回写 plan/00、06，写 HANDOFF-M2

## 既定口径清单（动了会打挂基准——改前对照，改后重跑 B1-B4）

1. IR 规范化规则（显式 dependsOn 覆盖隐式串接；未知模板变量编译期拒绝；引用 skip 节点输出 = 拒绝）
2. 快照序列化格式（2 空格缩进、属性序 = IR 字段序）
3. mock engine 接口签名与行为脚本格式（断言对象 = agent() 调用参数序列）
4. 能力 flag 探测方式（caps 预检先行，缺 agentOptions/toolFilter 即降级不静默）
5. 测试全离线（引擎 mock；在线冒烟仅人工门）
6. 官方子包依赖精确锚定：`@deepseek-ai/cordis 4.0.2`、`@deepseek-ai/dsh-{tools,brand,llm} 0.1.5-rc.1`（= 本机 dsh CLI 内置版本）；升级 = 新决策行
7. M0 自检行为：apply 内以 `ctx.tools.execute`（callId `dsh-pipeline-selftest-1`）自调 `pipeline_hello` 一次并打日志；M1 起若影响可加开关

## 本机环境坑（只写实测过的）

- pnpm 未预装 → `npm i -g pnpm@10 --registry=https://registry.npmmirror.com`；packageManager 已锁 10.34.5；仓库 `.npmrc` 已固定 npmmirror
- `npm view @deepseek-ai/dsh-tools` 的 `latest` 标签停在 0.0.1-rc.1，但 0.1.5-rc.1 早已发布 → 锚版本必须查 `versions` 全列表，别信 latest
- Node 24 + Git Bash 下 `node --test test/` 与 `node --test test` 都报 MODULE_NOT_FOUND（位置参数被当 glob/模块路径）→ 用裸 `node --test`（默认发现 `test/` 下 `*.test.js`，Node 20+ 通用，package.json 已如此）
- 本机 dsh CLI = 0.1.5-rc.1；npm 上 dsh `latest`=0.1.5-rc.3、`next`=0.1.7-rc.2。**调研文档（教程/02 号指南）对应 0.1.7 时代** → 涉 API 先对已装 dsh 的 `node_modules/@deepseek-ai/` 源码核对（M0 已核对 defineTool / ToolExecutionInput，与教程一致）
- 发现：`dsh --profile web --help` 也会加载 host 插件并触发 apply → 验证插件装载/注销最快的命令，无需启动服务器
- web profile 已存在且含用户数据；`dsh plugin ... add/remove` 实测干净可逆（失败自动回滚），无需备份

## DoD 逐项 checklist（M0，来自 plan/05 + 任务书，全部实测）

- [x] `dsh plugin --profile web add ./dsh-pipeline` 安装成功（link 安装；profile `dsh.profile.bundles` 追加 `dsh-pipeline`；本机有 dsh CLI 0.1.5-rc.1，无需 npx）
- [x] `dsh --profile web --dump-config` 可见 `# == dsh-pipeline` 层（insert 行 id=dsh-pipeline）
- [x] 插件 apply 无报错、工具注册成功（日志：`[dsh-pipeline] tool registered: pipeline_hello`）
- [x] 工具经真实管线执行成功（`ctx.tools.execute` 自检：`self-test replied: [{"type":"text","text":"Hello, dsh-pipeline! (dsh-pipeline M0)"}]`；无 key 替代验证见 plan/06 偏差 #1）
- [x] 卸载干净：`dsh plugin --profile web remove dsh-pipeline` → bundles 列表还原、dump-config 0 处 dsh-pipeline、重载日志 0 条（effect 语义实证）；已重装回激活态
- [x] 离线测试全绿（node:test 3/3）+ lint（tsc --noEmit）通过；CI 空壳（lint+test）就位

## 关键命令速查

```sh
# 安装到本地 dsh（在仓库父目录 dsh-1/ 执行；开发回路）
dsh plugin --profile web add ./dsh-pipeline
dsh --profile web --dump-config          # 验证层挂载（grep dsh-pipeline）
dsh --profile web --help                 # 最快验证 apply/注销（会加载 host 插件）
dsh plugin --profile web remove dsh-pipeline

# 基准与测试
pnpm install && pnpm build && pnpm test  # 离线测试（M1 起 pnpm bench 出 B1-B4）
pnpm lint
```
