# HANDOFF —— 跨会话交接快照（M6 起续接）

> 填写纪律：只写实测过的内容；环境坑必须带复现与解法；敏感字面值用占位符。
> 上一份：`HANDOFF-M5.md`（M5 发布期）。本份覆盖 M6 二次迭代（v0.2.0 → v0.2.2）。

## 当前进度

- 里程碑：M5（发布主体，2026-09-29）→ **M6（二次迭代，完成并发布 v0.2.2，2026-10-21/-22）**
- 仓库：`D:\ProgramData\zcode\09-29-dsh-pipeline`；远端 `git@github.com:yuluo554/dsh-pipeline.git`（SSH）；分支 `main`
- 版本：`package.json` = **0.2.2**；npm 包名 = **`@jadeluo/dsh-pipeline`**（**已上 registry，latest**）
- tag：**`v0.2.2`**（annotated）→ `d141bbb`（CI 绿）；Release 同 tag。**仓库只有这一个 tag**（旧 `v0.2.1` tag/Release 已删）
- 工作树：只剩 `?? update/`（M6 诊断交接目录，**刻意不入仓**：含本机绝对路径）

### 门禁现状（HEAD 在 `d141bbb` 之后仍成立）

| 门 | 结果 |
|---|---|
| `node --test` | **107 / 107 pass**（Node 24 本机；CI 22 与 24 两腿同绿） |
| `pnpm lint` | exit 0（两套 tsconfig） |
| `node scripts/bench.js` | B1 7/7 byte-exact、B2 22/22、B3 4/4、B4 6/6 → `ALL GREEN` |
| `node scripts/release-audit.mjs` | 111 跟踪文件 + 15 提交 0 命中 → `DESSENSITIZE_AUDIT_OK` |
| `npm pack`（**必须构建后**） | 74 文件 |

## 本批改了什么（M6）

详见 `plan/RELEASE-M6.md`（§1 兼容验收 / §2 门禁与负控 / §5 tag 时点 / §6 tag 后）与
`plan/06` 的六条 2026-10-21 决策行。要点：

1. **P0 兼容**：`engines` 加 `"dsh": ">=0.2.0-rc.1 <0.3.0-0"`。宿主只认 `engines.dsh`（有则忽略 peer）；
   旧的 13 个 peer 精确钉 `0.2.0-rc.1`，在 0.2.1-rc.2 上 12 条 unmet → 插件被拒。
2. **P1 npm 名**：改 scope 包（原无 scope 名被他人占用，发布从来不可能）。同步三处：
   `package.json` name、`cordis.patch.yml` 的 insert `name`（**这是 Loader 的 import() 说明符**）、
   client bundle 的 `__ModuleLoader__.load({id})`（改为从 manifest 读取，不再硬编码）。
   **内部标识保持不变**：Cordis 插件名 `dsh-pipeline`、路由 `/api/dsh-pipeline/*`、i18n 命名空间。
3. **P2 node 下界**：`>=20` **是错的** → `>=22`（官方 `@deepseek-ai/dsh-*` 用 `Promise.withResolvers`）。
   CI 矩阵 `[22, 24]`；actions 升 v7/v6。
4. **P2 自述**：README 测试计数 101/99 → 107 + `test/self-report.test.js` 守门。
5. **版本 0.2.2**：重冻结 7 份编译快照（**只 diff 第 1 行版本号**）。
   0.2.1 曾以 `@jadeluo/dsh-pipeline` 发上 npm 且内容正确，但它的 git tag 树里 `package.json` 仍是旧 scope
   `@yuluo554` → 升 0.2.2 重发，使「tag 树 == npm 发布物」成立。npm 上的 0.2.1 保留为有效历史版本。

## 未闭项（下一步就做这些）

**npm 发布已达成**（`@jadeluo/dsh-pipeline@0.2.2` = latest）。原先的两道阻塞与解法留档如下，供同类问题参考：

1. ~~**npm 发布**~~ → **已完成**。当时的两道叠加阻塞：
   - **凭据**：`~/.npmrc` 的 token 是 40 字符 `npm_` 前缀的 **classic token**（npm 已废弃）→ `npm whoami` 401、
     `npm publish` 404。解法 = 换 **granular access token**（Read and write + 目标 scope 的 publish），
     并取消该 token 的 2FA 要求（否则 `npm publish` 报 `EOTP`）。
   - **scope 所有权**：本账号 npm 用户名是 **`jadeluo`**（不是 GitHub 的 `yuluo554`），
     `@yuluo554/*` 这个 scope 本账号**从来无权发布**。解法 = 包名改 `@jadeluo/dsh-pipeline`。
   - 发布命令（**必须显式指真 registry**，本仓 `.npmrc` 是 npmmirror 镜像，镜像不接收发布）：
     ```sh
     npm publish --access public --registry=https://registry.npmjs.org
     npm view @jadeluo/dsh-pipeline version --registry=https://registry.npmjs.org
     ```
   - 注意：`scope` 首次发布必须 `--access public`，否则会发成私有（需付费计划）。
   - **额外坑**：新建 scope 包时 npm 会先放一个公开占位版 `0.0.0-stage`（"staged publishing"），
     真实版本随后才可解析；`npm install <pkg>` 若不指定版本，早期可能装到占位包（实测踩到）。
     → 复验时用 `npm install <pkg>@<version> --legacy-peer-deps`（插件 peer 只在 dsh 宿主里存在，
     裸装会 peer 冲突，这是预期）。
2. **awesome-dsh-plugin PR / #7704 回帖 / dsh-market 提交**：npm 已上线，可开始做（文案草稿见 `RELEASE-M5.md §4`）。
3. **真实 dsh 安装目检**：**用户 2026-10-22 明确决定跳过**（会改 profile）。替代证据已留：
   宿主判定函数判包内 manifest（0.2.x 全线 ACCEPTED、0.3.0-beta.1 REFUSED）+ 从 npm registry 真装后复验
   （`lib/` 37 文件、三处标识一致、宿主判定全对）。

## 本批踩到的坑（对环境/后续会话有用）

1. **`includePrerelease` 陷阱（诊断报告曾写错）**：dsh 的 `satisfies` 是
   `semver.satisfies(rt, range, { includePrerelease: true })`（`dsh-app-boot/lib/index.js:276-277`）。
   - 后果 A：`>=0.2.0-rc.1` **本来就能**匹配 `0.2.1-rc.2`（不是交接物写的 false）。
   - 后果 B：**没有上界的 range 会一路放行到 `dsh 1.0.0`**。所以必须带 `<0.3.0-0`。
2. **`lib/` 是 gitignored 的构建产物**（`git ls-files | grep '^lib/'` = 0），但 `files` 含 `lib`。
   → **裸 clone 打不出可用的 `.tgz`**；Release 附件必须在 `pnpm build` 之后打。
   `.gitignore` 已补 `*.tgz`，防止打出来的包装被误提交（M5 事故同源教训）。
3. **release-audit 只扫「已跟踪」文件**：新建文件**不 `git add` 就永远绿**。本批在写 `RELEASE-M6.md`
   时被它拦下一次（真实个人路径）。→ **改完文档先 add，再跑审计**。
4. **node 20 腿的价值**：它不是「覆盖面优化」，而是直接证明了 `engines.node >=20` 从来不成立。
   任何「声明下界」都应有对应 CI 腿，否则声明等于没验证。
5. **CI annotation 里的 "Node 20" 有两义**：一处指 **action 自身运行时**（升 actions 到 v7/v6 可消），
   一处指 **runner 的 `ubuntu-latest` 迁移到 Ubuntu 26**（本仓无法消，属环境信号）。
6. **本机网络**：`registry.npmjs.org` **直连可用**；走 `HTTPS_PROXY=127.0.0.1:7897` 反而连不上。
   查 registry 时用 `env -u HTTPS_PROXY -u HTTP_PROXY curl ...`。
7. **pnpm 的嵌套布局**：手动拼 `node_modules` 做加载冒烟会因为 `@deepseek-ai/*` 的传递依赖缺失而失败。
   正确做法是 `pnpm add <tgz>` 到一个临时目录（pnpm 会建正确的 peer 解析），再 `import`。

## 下一里程碑建议（若继续）

- npm 上线后：awesome PR + #7704 回帖 + dsh-market 提交（M5 §4 草稿已在）。
- 可选：把 `scripts/release-audit.mjs` 的范围从「已跟踪」扩到「工作树 + 未跟踪新增」（防上面第 3 条）。
- 可选：给 `engines.dsh` 的 0.3 放开做一次真实适配（当前刻意为不兼容）。

## 常用命令（本仓口径）

```sh
# 构建与门禁（注意：pnpm test 会先 build，重写 lib/）
pnpm install --frozen-lockfile
pnpm build        # tsc -> lib/ + esbuild client bundle
pnpm lint         # host + client 双 tsconfig
pnpm test         # build + node --test（107 例）
node scripts/bench.js            # 不带 build 的纯基准，自带退出码
node scripts/release-audit.mjs   # 脱敏门（先 git add 新文件，否则扫不到）

# 打 Release 附件（必须在 build 之后）
pnpm build && npm pack           # 产物 jadeluo-dsh-pipeline-0.2.2.tgz（*.tgz 已 gitignore）

# 兼容性权威判定（宿主公开导出，判的是本体）
node --input-type=module -e "
import { evaluatePluginCompatibility } from 'file:///<dsh 全局安装>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'
import { readFileSync } from 'node:fs'
console.log(evaluatePluginCompatibility(JSON.parse(readFileSync('package.json','utf8')), {}, '0.2.1-rc.2'))
"

# 本地开发回路（在仓库父目录执行）
dsh plugin --profile web add ./dsh-pipeline
dsh --profile web --dump-config          # 应见 "# == dsh-pipeline" 层 + workflow-ptc enabled
dsh plugin --profile web remove ./dsh-pipeline
```
