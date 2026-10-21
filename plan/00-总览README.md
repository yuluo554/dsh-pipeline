# dsh-pipeline 项目总览（plan/00）

> 项目：DeepSeek Harness 多节点工作流编排插件（回应 [dsh#7704](https://github.com/deepseek-ai/deepseek-harness/discussions/7704)）。
> 方法论：ai-tool-project-sprint（plan 先行 / 每周可演示 / 验收门回写 / 干净环境发布门）。
> 状态：**M6 二次迭代已发布 v0.2.2（2026-10-21/-22），并已上 npm**。GitHub 公开（yuluo554/dsh-pipeline），
> tag `v0.2.2` + Release（附 `.tgz` + `SHA256SUMS`；附件与 npm registry 上的 tarball **逐字节同一份**）；
> CI 两腿（Node 22 / 24）全绿；**npm 已发布 `@jadeluo/dsh-pipeline@0.2.2`**（`dsh plugin add` 可用）。
> 后续：awesome/#7704/dsh-market 可开始执行（文案草稿见 plan/RELEASE-M5.md §4）。
> 本文档集即任务编排产物；开发须按 plan/05 里程碑顺序执行，不跳步。

## 里程碑状态表（完成一项回写一项 ✅）

| 里程碑 | 内容 | 可演示物 | 状态 | 完成日期 |
|---|---|---|---|---|
| M0 | 仓库与 bundle 骨架 + hello 工具 | `dsh plugin add ./dsh-pipeline` 装上后 agent 能调用 hello 工具 | ✅ 已完成 | 2026-09-27 |
| M1 | 编译器 + runner + 命令/工具入口 | 3 节点 2 模型流水线真实跑通一次任务 | ✅ 已完成（离线全链路演示 + 实机装载冒烟；在线冒烟待 key，见 plan/m1-demo-log.md 与 06 偏差 #2） | 2026-09-27 |
| M2 | 护栏与失败策略（取消/重试/降级） | 运行中取消干净退出；坏节点按策略处理 | ✅ 已完成（abort/skip/retry 进编译器 + B4 6/6 + 真实引擎取消两通路 + 错误本地化 en/zh + skills 路由落地；见 plan/m2-demo-log.md 与 06 M2 决策行） | 2026-09-27 |
| M3 | Web 半编辑器 | 全程零手写 JSON 配置并运行一条流水线 | ✅ 已完成（dsh.client 声明 + esbuild client 构建 preset + store RPC 路由 + settings 编辑器 + 会话头运行页；DoD 双门离线全绿 + 实机装载/路由/保存链路留证；浏览器 GUI 级验证因本机 CDP 环境损坏列入 M4 人工冒烟，见 plan/m3-demo-log.md 与 06 M3 决策行） | 2026-09-28 |
| M4 | 运行视图 + 成本徽章 | 聊天中看到节点链状态卡与每节点耗时/成本 | ✅ 已完成（pipeline-run 会话事件族 + 宿主 recorder 写父会话日志 + conversation 定义折叠 + keyed 运行卡；每节点耗时/token 聚合 + 双模型用量对比；99/99 测试 + B1-B4 ALL GREEN + 实机装载/bundle/真会话集成留证；GUI 人工门延续 M3 偏差 #2，见 plan/m4-demo-log.md 与 06 M4 决策行） | 2026-09-29 |
| M5 | 发布 | npm 包 + GitHub 公开 + awesome PR + #7704 回帖 | 🔶 主体完成（README 完整化 + 兼容 floor ≥0.2.0-rc.1；干净环境验证全绿（发现#1 CRLF 已修+回归）；脱敏四步留档全 0；GitHub 公开可访问 + dsh-plugin 等 5 topic + CI 首跑绿 + 发布后 GitHub 全新 clone 复核 101/101；**npm 发包阻塞在 npm 登录（用户动作）**，awesome/#7704/dsh-market 待发包后执行；**M5 的「兼容声明修正」改的是不被读取的 `dsh.compatibility`，真缺陷留到 M6 修，见 plan/RELEASE-M6.md §1**） | 2026-09-29 |
| M6 | 二次迭代：兼容修复 + 发布路径明确 + 首个 tag | `dsh plugin --profile web add @jadeluo/dsh-pipeline` | ✅ 已完成（**`engines.dsh` 修复 P0**：dsh 宿主实测旧 manifest 12 条 unmet → 被拒、新 manifest `undefined`；`dsh.compatibility` 标注为文档字段；npm 名改 scope 包 `@jadeluo/dsh-pipeline`；**node 下界 `>=20` 实为错的 → `>=22`**；README 自述计数 101/99 → 107 + 自述守门；测试 101→107；B1-B4 ALL GREEN；脱敏 112 文件 0 命中；CI 两腿 22/24 全绿；**tag `v0.2.2` + Release**（`.tgz` 73,917 B + `SHA256SUMS`，与 npm tarball 逐字节同一份）；**npm 已发布 `@jadeluo/dsh-pipeline@0.2.2`**；0.2.1 曾在旧 scope 名下发布过且内容正确，因 tag 树与发布物不一致而升版重发，旧 tag/Release 已删） | 2026-10-22 |

## 文档索引

| 文件 | 内容 |
|---|---|
| [01-需求解读.md](01-需求解读.md) | 痛点→能力转译、FR 功能清单（带优先级）、**边界与非目标** |
| [02-架构与技术选型.md](02-架构与技术选型.md) | 双半包架构、官方依赖面清单（版本锚定）、兼容层策略 |
| [03-模块详设.md](03-模块详设.md) | host/client 模块职责、关键签名、模块级测试点 |
| [04-测试与基准计划.md](04-测试与基准计划.md) | 数据先行（fixtures+真值）、离线基准、指标门槛、既定口径 |
| [05-里程碑.md](05-里程碑.md) | M0-M6 任务编排（含并行分工与 Agent 编排建议）、DoD |
| [06-交付对标与决策记录.md](06-交付对标与决策记录.md) | FR↔#7704 对照、验收门 checklist、决策记录表 |
| [HANDOFF-M1.md](HANDOFF-M1.md) | 跨会话交接快照（M0 结束填写；**已过时仅作历史**，M1 起见 HANDOFF-M2） |
| [HANDOFF-M2.md](HANDOFF-M2.md) | 跨会话交接快照（M1 收尾填写，M2 由此续接） |
| [HANDOFF-M3.md](HANDOFF-M3.md) | 跨会话交接快照（M2 收尾填写，M3 由此续接） |
| [HANDOFF-M4.md](HANDOFF-M4.md) | 跨会话交接快照（M3 收尾填写，M4 由此续接） |
| [HANDOFF-M5.md](HANDOFF-M5.md) | 跨会话交接快照（M4 收尾填写，M5 由此续接） |
| [HANDOFF-M6.md](HANDOFF-M6.md) | 跨会话交接快照（M6 二次迭代收尾填写；**当前最新交接，含未闭项与下一步**） |
| [RELEASE-M5.md](RELEASE-M5.md) | M5 发布门留档（含 M6 在 §3 追加的更正注记：npm 阻塞是所有权，不是登录） |
| [RELEASE-M6.md](RELEASE-M6.md) | **M6 发布留档**：兼容验收（含对诊断报告 `includePrerelease` 的更正）、门禁、负控、tag/Release 与发布物自证 |
| [m1-demo-log.md](m1-demo-log.md) | M1 演示留档：bench 指标 + 离线全链路 trace + 实机装载冒烟 |
| [m2-demo-log.md](m2-demo-log.md) | M2 演示留档：B1-B4 指标 + 三策略/取消 trace（含真实引擎）+ 实机装载冒烟 |
| [m3-demo-log.md](m3-demo-log.md) | M3 演示留档：DoD 双门测试 + 启动图/bundle/API 路由实机留证 + client bundle 运行时冒烟 |
| [m4-demo-log.md](m4-demo-log.md) | M4 演示留档：运行卡事件链测试 + 真实 Session 集成 + 实机装载/bundle 留证 |

## 验收门（全部通过才算项目完成，逐项打勾）

- [x] plan/ 台账齐全，里程碑状态已回写（本表 + 05 + 06）
- [x] 离线基准可重复（零 API 依赖），指标达标并写入 README（B1 7/7 · B2 22/22 · B3 4/4 · B4 6/6，CI 同源断言）
- [x] 端到端演示通过：`dsh plugin add` 安装 → 配置流水线 → 一键运行 → 结果落盘（离线全链路 + 实机装载/路由/保存/运行卡事件链实测；真实模型在线冒烟 = 五代合并人工门，无 key，plan/06 偏差登记在案）
- [x] 测试全绿（含失败路径：坏定义/未知模型/能力不支持降级/取消中断）——**107/107**（M6：含兼容守门 + 自述计数守门 + EOL 守门 + 脱敏守门）
- [x] 干净环境验证：新目录 clone + 全新 Node 环境（不依赖开发机全局包）按 README 一次跑通（发现 #1 Windows clone CRLF 已修 + 回归测试；M6 复验：仓库外 clone + 隔离 store，install/lint/test/bench/audit/pack 六连全绿）
- [x] 脱敏四步通过并留档（plan/RELEASE-M5.md + plan/RELEASE-M6.md §6），历史全 0 命中（M6 实测 111 跟踪文件 + 15 提交），GitHub 公开可访问（https://github.com/yuluo554/dsh-pipeline）
- [x] **有可被引用的版本**（M6 新增门）：tag `v0.2.2` + Release，附 `.tgz` + `SHA256SUMS`；附件与 npm registry 上的 tarball **逐字节同一份**（sha1 `cd49371a…` 两边相等），本地/GitHub digest/真下载复算三值一致；包内 manifest 经 dsh 宿主判定函数对 0.2.x 全线 ACCEPTED、0.3.0-beta.1 REFUSED
- [x] **npm registry 可安装**（M6 达成）：**`@jadeluo/dsh-pipeline@0.2.2` 已发布**（latest），74 文件 / 257,289 B unpacked。
      从 registry 真装复验：`lib/` 37 文件、包名与 patch 说明符与 client 注册 id 三处一致、宿主判定对 0.2.x 全线 ACCEPTED。
      （过程教训：本账号 npm 用户名是 `jadeluo`，`yuluo554` 只是 GitHub 用户名 → 早期选的 `@yuluo554/*` scope 本账号无权发布；
      另 `~/.npmrc` 原 token 是已废弃的 classic 型。两者叠加才导致此前的 401/404。）

## 执行纪律摘要（长任务行为约束）

1. **查证优先**：涉及 dsh API 签名/行为，以官方仓库对应 tag 的源码与文档为准，不凭记忆写代码；不确定先查 `dsh-plugin-research/official-docs/` 存档或 gh api，查不到标"待核对"。
2. **口径熔断**：同一设计问题推理两遍无新证据 → 停止推理，转查证或落决策记录表（plan/06）。
3. **每里程碑收尾**：回写状态表 + 写 HANDOFF-M<next>；没做到的 DoD 写偏差说明，如实留档。
4. **Windows 环境**：npm/pnpm 走 npmmirror fallback（dsh plugin-manager 已内置 fallback，本地开发用 `.npmrc` 固定）；控制台一律 UTF-8；长安装用后台任务；push 失败先查代理。
