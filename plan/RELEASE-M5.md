# RELEASE-M5 —— 发布门执行留档（plan/05 逐条，2026-09-29）

> 纪律：只写实测过的；命令与结论逐条留痕；敏感字面值一律占位符（本文件自身在审查脚本扫描范围内，引述即 FAIL）。

## 0. 发布前置改动（已提交）

| 改动 | 提交 | 说明 |
|---|---|---|
| README 完整化 | 7cf05ab | 简介/特性/mermaid 架构/快速开始/评测表/限制/免责/已知环境问题；LICENSE 此前已在 |
| 兼容声明修正 | 7cf05ab | `dsh.compatibility.dsh` 从 0.1.x 线提升为 `>=0.2.0-rc.1`——0.2.0 起 patch 行是 `workflow-ptc`，0.1.x 宿主无此引擎 id，插件必然 pending 不激活；且 plugin-manager 按 peer 预检会拒绝不兼容安装（见 plan/06 决策行） |
| 干净环境修复 #1 | 459733d | `.gitattributes` 强制 LF 检出 + EOL 守门测试（见 §5 发现 #1） |
| README 链接/计数 | 3218878 | plan/ 深链改指 GitHub（npm tarball 无 plan/）；测试计数随守门测试同步 |
| 脱敏审查固化 | fbdaa3c | `scripts/release-audit.mjs` + `test/desensitize.test.js`（随全量测试运行）+ `pnpm release:audit` |

## 1. 脱敏四步（plan/05 口径，全部经 `node scripts/release-audit.mjs` 留痕）

**步骤 1 —— 文件名门**：`git ls-files | grep -iE "\.env$|\.key$|secret|token"` → **0 命中**
（105 个跟踪文件）。`.gitignore` 覆盖 `.env`/`.env.*`/`*.key`/`*.log`/`data/**/_private/`（M0 起在位）。

**步骤 2 —— 内容级扫描**（全部跟踪文本，7 类模式）：

| 模式 | 结果 |
|---|---|
| `sk-` 形态密钥 | 0 命中 |
| 密钥赋值（secret/token/key/password = 不透明字面值；叙述式引用如 token = session/event 不算） | 0 命中 |
| 手机号（11 位大陆号段） | 0 命中 |
| 身份证（18 位） | 0 命中 |
| 个人路径 `C:\Users\xx` 形态 | 0 命中（plan/05 与 HANDOFF 引述占位符字面量本身，脚本白名单放行） |
| 内网 IP（10/192.168/172.16-31 段） | 0 命中 |
| 邮箱 | 0 命中（保留域 example.com 白名单未触发） |

**步骤 3 —— 占位符纪律**：传递性强制——本文件与审查脚本自身是跟踪文件，步骤 2 扫到即 FAIL；
本文件引述敏感字面值一律用占位符（已执行）。

**步骤 4 —— 历史扫描**（首推前执行：首推发布全部本地历史）：
`git log --all -p` 全补丁内容行 + `git log --all --format=%s%n%b` 提交信息，按同 7 类模式 →
**0 命中**（推送时刻的提交数以脚本输出为准；曾实测 10 提交全 0）。历史重写条款仅"已推送后发现
敏感内容"时适用，本次首推前已清零，无需重写。

**二进制样例**：跟踪文件扩展名普查 = js/json/md/ts/tsx/mjs/yml/yaml/npmrc/gitignore/LICENSE，无二进制；
扫描步骤自动跳过二进制（当前 0 个）。后续若有二进制入仓，按 plan/06 加 sha256 白名单 + 数据台账联动。

**守门**：`test/desensitize.test.js` 随 `pnpm test` 运行（当前 101 例含此例）；任一步 FAIL 非零退出，
全过打印 `DESSENSITIZE_AUDIT_OK`（实测输出见上）。

**已知残余暴露面（如实登记）**：提交作者邮箱为个人 QQ 邮箱（占位不复述），随 git 提交元数据公开——
属用户身份决策，不擅改；如需隐藏须重写全部提交作者信息（历史重写级动作，需用户明确授权），
或后续提交改用 noreply 地址。除此外无已知暴露面。

## 2. 干净环境验证（skill 阶段 7 发布门核心，2026-09-29 实测）

环境：全新目录 `m5-clean/dsh-pipeline`（本仓库父目录内、仓库外的独立 clone）+ 隔离 pnpm store
（`--store-dir .clean-store`，实际下载 68MB，不依赖开发机 store）。

按 README 逐条执行：

| 步骤 | 结果 |
|---|---|
| `pnpm install`（隔离 store，npmmirror） | ✅ 一次过；全套 `@deepseek-ai/*` 0.2.0-rc.1 从公共 registry 解析（0.2.0 新增的 workflow-ptc/ptc-runtime 包均在） |
| `pnpm build` | ✅（pnpm 10 拦 esbuild postinstall 警告无害：二进制经 optionalDependencies 通路） |
| `pnpm test` | ✅ 100/100（首 clone 时 B1 全挂，见发现 #1；修复后全绿） |
| `pnpm bench` | ✅ B1 7/7 · B2 22/22 · B3 4/4 · B4 6/6 · ALL GREEN |
| `pnpm lint` | ✅ |
| 实机回路（clone 父目录执行） | ✅ `dsh plugin --profile web add ./dsh-pipeline` → `--dump-config` 可见 dsh-pipeline 层 + workflow-ptc enabled → 后台启动 0 did-not-activate、工具注册+自检回复 → 认证栅栏后 `GET /api/dsh-pipeline/inventory` 200（双工具在册）→ 卸载、恢复 dev link |

### 发现 #1（已修复 + 回归测试）：Windows 全新 clone 挂 B1

- **现象**：首 clone `pnpm test` B1 全 7 份快照 diff；开发目录同刻全绿。
- **根因**：开发机全局 `core.autocrlf=true`，clone 检出把 LF 冻结快照重写为 CRLF；
  B1 是逐字节比对（口径 2 的落盘字节契约）。开发目录从未走检出所以从未暴露；
  CI 在 Linux（autocrlf=false）也测不到——**任何 Windows 用户 clone 即挂**。
- **修复**：`.gitattributes` 全仓 `* text=auto eol=lf`（冻结真值语义不动、不改弱测试）；
  复 clone 后全绿。
- **回归测试**：`test/eol.test.js` 守门——冻结 fixtures 出现 CR 字节即大声失败并指向修复文档。
- 判别教训：B1 报 7 份全 diff + dev 绿 = 环境差异信号，逐字节 od 对比定位（首测曾把 clone
  快照误当 dev 快照对比，教训 = 字节级对比必须带绝对路径）。

## 3. npm 发包（预检完成；**发布动作阻塞在 npm 登录**）

- `npm pack --dry-run`：**74 文件 / 72.8 kB**；内容 = `lib/`（预编译 host + client bundle）+
  `cordis.patch.yml` + `locale/` + `data/`（fixtures/快照/README）+ README/LICENSE/package.json；
  **无 plan/、test/、src/ 泄漏**。
- `npm whoami` → ENEEDAUTH：**本机未登录 npm**，发布动作需用户执行（或提供已登录环境）：
  ```sh
  npm login            # 或 npm adduser
  npm publish          # 包已含预构建 lib/；首次发布无 --access 问题（非 scope 包默认 public）
  ```
- 发包后复核：`npm view dsh-pipeline` + 全新目录 `dsh plugin --profile web add dsh-pipeline`
  （plugin-manager 按 registry 查询安装，官方文档 pkg-plugin-manager 口径；npmmirror 为内置 fallback）。

## 4. GitHub 发布与推广（推送链）

- 已核查：gh 已登录（账号 yuluo554，repo 权限）；仓库无远端（首推发布全部历史，步骤 4 已先清零）。
- 执行序（对应 plan/05【并行】行）：
  1. 建仓 + 首推：`gh repo create dsh-pipeline --public --source . --push --description <一句话>`
  2. topic：`gh repo edit --add-topic dsh-plugin`（官方发现话题）+ 其它（workflow/orchestration 等）
  3. awesome-dsh-plugin PR：双语条目（收录标准 = `dsh plugin add` 可装 + 描述属实 + 有人维护）
  4. #7704 回帖：交付说明 + 链接
  5. dsh-market：收录 awesome 全量（4.6k★ 市场跑 awesome 清单），awesome 入列即覆盖；如需直投另行看其仓库提交口径
- **时序纪律**：3/4/5 依赖 npm 包可装（条目里写 npm 安装命令），npm 未发包前不提交——
  避免对外宣称与实际不符；npm 发包后按此序执行并回填本节执行结果。

### 对外文案草稿（npm 发包后使用）

**awesome-dsh-plugin 条目**（双语清单，随其 README 格式归入工具/工作流类）：

> - **[dsh-pipeline](https://github.com/yuluo554/dsh-pipeline)** — 多节点 agent 流水线编排：JSON
>   定义（每节点独立 prompt/model/skills、失败策略、显式 DAG）、编译为官方 workflow 引擎脚本一键运行、
>   Web 编辑器 + 会话流实时运行卡（逐节点状态/耗时/token）。`dsh plugin add dsh-pipeline`。回应 #7704。
>   EN: Multi-node agent pipeline orchestration for dsh — JSON-defined nodes (per-node model/skills,
>   failure policies, explicit DAG), compiled to native workflow-engine scripts; web editor and
>   in-session live run cards. Responds to discussion #7704.

**#7704 回帖草稿**：

> 交付了：`dsh-pipeline`（<repo 链接> + npm `dsh-pipeline`）——把本帖诉求做成插件：
> 流水线定义为 JSON（每节点独立 model/skills、prompts 序列、模板变量、失败策略/重试、显式 DAG），
> 编译为官方 workflow 引擎脚本（无 eval）运行；附带 Web 编辑器（零手写 JSON）与会话流内实时运行卡
> （节点链状态、每节点耗时/token、双模型成本对比）。内置离线基准（编译快照/校验矩阵/策略矩阵）。
> 要求 dsh ≥ 0.2.0-rc.1。已知闸门：节点级 tools 路由与 reasoningEffort（引擎 seam 暂无通路，编译期显式拒绝）。

## 5. 时间线（如实，不回填）

- 2026-09-29：README 完整化 + 兼容声明修正（7cf05ab）→ 干净环境首 clone 发现 #1 → 修复+回归（459733d）
  → 复 clone 全流程 + 实机回路全绿 → README 链接/计数（3218878）→ 脱敏探索扫描 → 审查脚本+守门（fbdaa3c）
  → npm pack 预检 74 文件无泄漏 → **npm publish 阻塞：本机未登录（ENEEDAUTH），移交用户**。
- 推送（建仓+topic）在本留档提交、plan 回写与最终审查通过后执行；awesome/#7704/dsh-market 待 npm 发包后按 §4 序执行。
