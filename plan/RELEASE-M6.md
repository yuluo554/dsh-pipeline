# RELEASE-M6 —— 二次迭代发布留档（v0.2.0 → v0.2.1，2026-10-21）

> 纪律：只写实测过的；命令与结论逐条留痕；敏感字面值一律占位符（本文件自身在审查脚本扫描范围内，引述即 FAIL）。
> 形态沿用 `RELEASE-M5.md`：**第一节 = tag 时点事实**（打 tag 前写定），**第二节 = tag 后追加事实**（打完 tag 才可写）。
> 缺陷编号与 `update/00-诊断报告.md` 一致；决策依据与 `plan/06` 的 2026-10-21 五行一致。

## 0. 本次迭代改了什么（提交清单以 §2 实测为准）

| 批次 | 缺陷 | 改动 | 文件 |
|---|---|---|---|
| 1 | **D1（P0）** | 兼容声明改为 `engines.dsh` 单点决定：`">=0.2.0-rc.1 <0.3.0-0"` | `package.json` |
| 1 | D2（P1） | `dsh.compatibility` 保留为文档元数据并标注不参与校验，值同步为上界范围 | `package.json`、`README.md` |
| 1 | — | 新增兼容守门（复制宿主判定逻辑，10 个版本正反控） | `test/compat.test.js`（新） |
| 2 | **D3（P1）** | npm 包名改 scope 包 `@yuluo554/dsh-pipeline`；Loader 模块说明符同步；client bundle 注册 id 改为从 manifest 读取 | `package.json`、`cordis.patch.yml`、`scripts/build-client.mjs`、`test/client-bundle.test.js`、`README.md` |
| 3 | D8（P2） | README 测试计数 101/99 两处 → **107**，并新增自述计数守门 | `README.md`、`test/self-report.test.js`（新） |
| 3 | D5（P2） | M5 留档的 `74 文件 / 72.8 kB` → `74 文件`（不记 kB） | `plan/RELEASE-M5.md` |
| 3 | **D4（P2 → 实为声明错误）** | CI 先加 node 20 腿 → 该腿揪出真缺陷（官方依赖用 Node 22+ API）→ `engines.node` 由 `>=20` 改 **`>=22`**，CI 矩阵改 `[22, 24]` | `package.json`、`.github/workflows/ci.yml`、`README.md` |
| 3 | — | 版本 0.2.0 → **0.2.1** + 重冻结 7 份编译快照（唯一差异 = 首行版本号） | `package.json`、`src/version.ts`、`data/snapshots/*.js` |
| — | DEC2=B | 决策记录五行落档 | `plan/06-交付对标与决策记录.md` |

**未做（诊断报告提及但不在本批验收门内）**：没有改 workflow 引擎 / compiler / IR / runner 的判定逻辑；
没有删任何现有测试；没有降 `bench.js` 的四门槛；没有动 `scripts/release-audit.mjs` 的三步扫描。

## 1. 兼容性验收（本批核心，G1）

### 1.1 与交接物的一处更正（`includePrerelease`）

交接物（`update/00`、`update/01`、`update/02`）写 dsh 调 `semver.satisfies(rt, range)` **不传** `includePrerelease`。
**这是错的**。宿主源码（dsh 0.2.1-rc.2，`dsh-app-boot/lib/index.js:276-277`）：

```js
function satisfies(runtimeVersion, range) {
  return range.trim() !== "" && semver.satisfies(runtimeVersion, range, { includePrerelease: true });
}
```

预发布**参与所有 range**。所以 `>=0.2.0-rc.1` 本身就能匹配 `0.2.1-rc.2`（实测 true，见 §1.2 第 2 行）。
让 M5 声明在 0.2.1-rc.2 上失效的**真正原因**是那 13 个 peer 钉的**精确字符串** `"0.2.0-rc.1"`
（精确值只能匹配它自己，任何其它版本都不满足）——不是预发布排除。

**结论不变、论证路径改**：M5 manifest 在 0.2.1-rc.2 上仍被拒（12 条 unmet，见 §1.3 负控），
修复动作（`engines.dsh`）仍有效。（更正详情另存于本机诊断交接目录 `update/03-更正-兼容性判定.md`；
该目录含本机绝对路径，**不随仓库发布**，故本节的更正内容自足，不依赖它。）

### 1.2 range 选型（为什么是 `>=0.2.0-rc.1 <0.3.0-0`）

因为 `includePrerelease: true`，**宽 range 会连带放行未来大版本**。用仓内 `semver@7.8.5` 实测
（`satisfies(v, r, { includePrerelease: true })`）：

| range \ version | 0.2.0-rc.1 | 0.2.0 | 0.2.1-rc.2 | 0.2.1 | 0.2.9 | 0.3.0-0 | 0.3.0-beta.1 | 0.4.0-alpha | 1.0.0 |
|---|---|---|---|---|---|---|---|---|---|
| `>=0.2.0-rc.1`（M5 的 `dsh.compatibility`） | true | true | **true** | true | true | true | true | true | **true** |
| `>=0.2.0-rc.1 \|\| >=0.2.1-rc.1`（提示词建议） | true | true | true | true | true | true | true | true | **true** |
| `^0.2.0-rc.1` | true | true | true | true | true | false | false | false | false |
| **`>=0.2.0-rc.1 <0.3.0-0`（本批采用）** | true | true | **true** | true | true | **false** | **false** | **false** | **false** |

提示词给的 range 与 README「只支持 `dsh.compatibility.dsh` 锁定的 preview 线」自相矛盾——
它会接受 `dsh 1.0.0`。上界 `<0.3.0-0` 是唯一同时满足「0.2.x 全包（含预发布）」与「0.3+ 全拒」的写法。
用户已就此单独拍板（DEC1 衍生项）。

### 1.3 用**真实 dsh 宿主函数**判定（G1 的权威验收）

**唯一权威验收**是「插件装进真机 dsh 0.2.1-rc.2 后为 enabled」——那会改用户 profile，本批**不执行**
（如实登记）。可达的最强替代 = 直接调用宿主导出的判定函数（不是测试副本）：

```sh
node --input-type=module -e "
import { evaluatePluginCompatibility } from 'file:///<dsh 全局安装>/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'
import { readFileSync } from 'node:fs'
const m = JSON.parse(readFileSync('<repo>/package.json','utf8'))
console.log('issue =', evaluatePluginCompatibility(m, {}, '0.2.1-rc.2'))
"
```

| manifest | runtime | 结果 | 退出码 |
|---|---|---|---|
| **本批修后** | `0.2.1-rc.2` | **`issue = undefined`**（全部满足，不会被拒载） | 0 |
| M5 原样（`git show HEAD:package.json`，`engines` 只有 `node`） | `0.2.1-rc.2` | `REFUSED, unmet=12` | 0 |
| M5 原样 | `0.2.0-rc.1` | `undefined`（这解释了为什么 M5 本地全绿） | 0 |

**D1 的「插件会被拒绝加载」由此从推演升级为宿主函数实测**（判的是本体，不是副本）。

### 1.4 仓内兼容守门

`test/compat.test.js`（新，5 条）把宿主的 `satisfies` + `unmetRequirements` 逐行复制进测试
（`dsh-app-boot/lib/index.js:276-298`，注释注明出处与「复制而非 import」的理由：宿主私有路径无稳定导出），
断言：

- 6 个受支持运行时（`0.2.0-rc.1`/`0.2.0-rc.2`/`0.2.0`/`0.2.1-rc.2`/`0.2.1`/`0.2.9`）unmet 集合**全空**；
- 4 个越线运行时（`0.3.0-0`/`0.3.0-beta.1`/`0.4.0-alpha`/`1.0.0`）**全被拒**；
- `engines.dsh` 存在时**遮蔽** 13 个精确 peer（防「下次有人改 peer 而不是改 engines」）；
- `dsh.compatibility` 与生效 range **一致**（防两处声明漂移）。

## 2. 全套门禁实测（tag 时点，2026-10-21）

### 2.1 仓库工作树（Node v24.15.0、pnpm 10.34.5）

| 门 | 命令 | 结果 | 退出码 |
|---|---|---|---|
| 测试 | `node --test` | **107 tests / 107 pass / 0 fail / 0 skipped** | **0** |
| lint | `pnpm lint` | 两套 tsconfig 无输出（干净） | **0** |
| bench | `node scripts/bench.js` | B1 **7/7 byte-exact**、B2 **22/22**、B3 **4/4**、B4 **6/6**、`ALL GREEN` | **0** |
| 脱敏审计 | `node scripts/release-audit.mjs` | step1 108 文件 0 命中 / step2 108 文本 0 命中 / step4 13 提交 0 命中 → `DESSENSITIZE_AUDIT_OK` | **0** |
| npm pack | `npm pack --dry-run` | **74 文件**（无 `plan/`、`test/`、`src/` 泄漏） | 0 |

**测试计数 101 → 107 的构成**：+5（`compat.test.js`）+1（`self-report.test.js`）。
注意 `107` 比「已有 101 + 5 + 1 = 107」对得上，其中 `test/helpers.js` 仍是那条**零声明的文件级记录**（占 1）。
新的自述计数守门把 README 的两处声明与这条收集规则锁在一起（见 §2.3）。

### 2.2 干净环境验证（发布门核心）

环境：`<TEMP>\dsh-clean-m6\repo`（独立 clone + 覆盖本批未提交改动，**仓库外**）+ 隔离 pnpm store
`--store-dir <TEMP>\store`（不依赖开发机 store）。`<TEMP>` = 系统临时目录（本机绝对路径不入仓，脱敏门拦）。

| 步骤 | 结果 |
|---|---|
| `pnpm install --frozen-lockfile`（隔离 store，npmmirror） | ✅ 一次过（lockfile 只多 `semver: 7.8.5` 三行，见 §2.4） |
| `pnpm lint` | ✅ 退出 0 |
| `pnpm test`（= build + `node --test`，会重建 `lib/`） | ✅ **107/107**，退出 0 |
| `node scripts/bench.js` | ✅ ALL GREEN，退出 0 |
| `node scripts/release-audit.mjs` | ✅ `DESSENSITIZE_AUDIT_OK`，退出 0 |
| `npm pack --dry-run` | ✅ 74 文件 |

### 2.3 负控清单（逐条贴退出码，`cmd >file 2>&1; echo $?`）

| # | 负控 | 期望 | 实测 | rc |
|---|---|---|---|---|
| NC1 | 修后 `engines.dsh` 对 6 个受支持版本 true、4 个越线版本 false | 全对 | 0.2.0-rc.1/0.2.0/0.2.1-rc.2/0.2.1/0.2.9 = true；0.3.0-0/0.3.0-beta.1/0.4.0-alpha/1.0.0 = false | 0 |
| NC2 | 摘掉 `engines.dsh`（复现 M5 路径）→ 0.2.1-rc.2 必须 12 条 unmet | 12 | `NO engines.dsh, 0.2.1-rc.2 unmet = 12`；`WITH engines.dsh = 0`（探针有效） | 0 |
| NC3 | 宿主校验函数附近（`:271-320`）grep `compatibility` | 0 | **0 命中**（`dsh.compatibility` 确实不被读） | 0 |
| NC4 | registry 的 `dsh-pipeline` owner 仍为 tudamu/0.0.1 | 是 | `latest: 0.0.1`、`maintainers: tudamu`（直连 `registry.npmjs.org`；经代理 127.0.0.1:7897 反而连不上） | 0 |
| NC5 | README `99 例` = 0、`107 例` ≥ 1、裸装命令 `add dsh-pipeline` = 0、`add @yuluo554/dsh-pipeline` = 1 | 全对 | 0 / 2 / 0 / 1 | 0 |
| NC6 | 恒定回归：测试 107/107、bench ALL GREEN | 是 | `tests 107 / pass 107 / fail 0`、`ALL GREEN` | 0 / 0 |
| NC7 | 脱敏审计仍绿（改了 README/package.json 必须重跑） | 绿 | `DESSENSITIZE_AUDIT_OK` | 0 |
| NC8 | 打包边界仍干净 | 74 文件 | `total files: 74`（`package size 73.9 kB`） | 0 |

### 2.4 依赖变更的边界（如实）

新增一条 **devDependency `semver@7.8.5`**（供 `test/compat.test.js` 判定 range 用）。
它**已在 lockfile 里**（是既有传递依赖，`pnpm-lock.yaml` 早已有 `semver@7.8.5` 条目），
所以改动只是 importers 段多 3 行、**没有拉入任何新包**：

```
+      semver:
+        specifier: 7.8.5
+        version: 7.8.5
```

`pnpm add -D semver@7.8.5` 首次执行时顺带把 `@deepseek-ai/cordis-plugin-loader` 从 1.0.3 升到 1.0.5
（含 400+ 行 lockfile 抖动）——**已回滚、改为手工最小编辑**，避免把一次无关的传递依赖升级夹带进本批。

### 2.5 node 下界是本次迭代抓到的**第二个真缺陷**（D4 的实质）

D4 在交接物里记为「P2 · 覆盖缺口」（声明 `>=20` 但只测 22）。**加 node 20 腿后它从缺口变成声明错误**：

```
# CI node 20 腿（v20.20.2），4 个真实 PTC 引擎测试全红：
TypeError: Promise.withResolvers is not a function
    at PtcWorkflowRun.childResult (.../@deepseek-ai/dsh-workflow-ptc/lib/index.js:358:27)
```

- `Promise.withResolvers` = V8 12.4 / **Node 22+** 的 API。实测：node 20.20.2 → `undefined`；
  node 24.15.0 → `function`。
- 出错点在**官方依赖**里，不是本仓代码：`dsh-workflow-ptc` 1 处、`dsh-agent` 1 处、`dsh-subagent` 5 处。
  即**真实 dsh 在 node 20 上也会崩**——本插件声称支持 node 20 从一开始就站不住。
- 本机用 CI 同版本 node 20.20.2 完整复现：**103 pass / 4 fail**（node 22/24 全过）。
- 处置：`engines.node` → **`>=22`**，CI 矩阵 → `[22, 24]`。**没有给测试加 node<22 跳过**
  （跳过会让声明继续骗人，且属提示词纪律 ①/② 禁止的「跳测试变绿」）。

**为什么 M5 没发现**：M5 的 CI 只有 node 22 一条腿，而 node 22 恰好有 `withResolvers`——
缺陷与验证环境同版本，天然不可见。这正是「声明下界必须有对应 CI 腿」的实证价值。

## 3. tag 与 GitHub Release

- tag：`v0.2.1`（annotated），指向 CI 绿的那个提交（实测见 §5 tag 后追加事实）。
- Release 附件：`npm pack` 产物 `.tgz` + `SHA256SUMS`。**这是本仓第一个 tag/Release**（M5 无 tag、无 Release）。
  附件的意义：`dsh-pipeline` 这个 npm 名归他人所有，本包按 DEC3=A 改走 scope 包，scope 包**首次发布**
  需用户 `npm publish --access public`（本批不执行，属人工门）；在 npm 上线前，用户可凭 Release 附件拿到
  与 tag 一一对应的可安装件。
- **`lib/` 是 gitignored 的构建产物**（`git ls-files | grep '^lib/'` = 0），但 `npm pack` 的 `files` 含 `lib`
  ——所以 `.tgz` 必须在**构建后**的工作树里打（`pnpm build` 已跑），不能从裸 clone 打（裸 clone 无 `lib/`，
  包会缺预编译产物）。这是「安装即用」前提的实证口径。

## 4. 需要人做的事（本批不做，移交）

1. **npm 发布**（DEC3=A 的闭环）—— **已实测确认是硬阻塞，不是"未登录"这么简单**：

   | 探针 | 结果 |
   |---|---|
   | `npm whoami --registry=https://registry.npmjs.org` | **E401** |
   | `npm profile get --registry=https://registry.npmjs.org` | `Unable to authenticate, your authentication token seems to be invalid` |
   | `curl -H "Authorization: Bearer <token>" https://registry.npmjs.org/-/whoami` | **http=401**，body `{}` |
   | `npm publish --access public --registry=…` | **E404**（PUT `@yuluo554%2fdsh-pipeline` — 未认证下的权限错误） |
   | `npm publish --dry-run` | **通过**：74 文件、public access、`+ @yuluo554/dsh-pipeline@0.2.1` |
   | `GET https://registry.npmjs.org/@yuluo554%2Fdsh-pipeline` | **404** → scope 下无同名包，**名字可用** |

   根因：`~/.npmrc` 里的 `//registry.npmjs.org/:_authToken` 是 **40 字符、`npm_` 前缀的 classic token**，
   npm 已废弃该类型。需换 **granular access token**（权限：Read and write；勾选该 scope 的 publish）。
   换好后：
   ```sh
   npm publish --access public --registry=https://registry.npmjs.org   # 必须显式指真 registry
   npm view @yuluo554/dsh-pipeline version --registry=https://registry.npmjs.org
   ```
   **本仓 `.npmrc` 是 npmmirror 镜像，镜像不接收发布**；scope 包首次发布必须 `--access public`（否则发成私有）。
2. **真实 dsh 安装目检**（唯一权威验收）：把 `@yuluo554/dsh-pipeline` 装进跑 dsh 0.2.1-rc.2 的环境，
   确认插件 enabled 且 web 面板可见流水线入口。**会改用户 profile** —— 用户已于 2026-10-22 **明确决定跳过**；
   替代证据见 §6.3（宿主判定函数判包内 manifest + `.tgz` 装后 import 冒烟）。
3. **contacts**（若改走 DEC3=C）：`dsh-pipeline` 现任 maintainer 邮箱见 registry 公开字段（本文件不复述，避免触发脱敏门）。

## 5. tag 时点事实（打 tag 前写定，2026-10-21）

### 5.1 代码树的 CI 证据（三个 run，逐条列 sha，不写「本提交」避免自指）

CI run **`39628634985`**，`head_sha = 1fd5791be21eda5b967b587663797b24ac6996ca`
（本次迭代最后一次改动代码/配置的提交；其后的提交只改 `plan/`、`update/` 文档，不改门禁对象），
event = push，conclusion = **success**，两腿 **`ci (22)` success / `ci (24)` success**（各 11 steps）。

- **annotation = 2 条**，均为 runner 侧通知：
  `"The ubuntu-latest label will migrate to Ubuntu 26 beginning October 19, 2026."`
  （本仓无法消除：`ubuntu-latest` 是 runner 侧标签；若要钉死须显式写 `ubuntu-24.04`。）
- 文档提交自身的 CI run id 记在 §6（打完 tag 才能写，见底部「自指」说明）。

### 5.2 本批三次 CI 实录（如实，含一次真缺陷暴露）

| run id | head | 结论 | 说明 |
|---|---|---|---|
| `39625832990` | 首次推送 | node 22 success / **node 20 failure** | 4 个真实 PTC 引擎测试报 `Promise.withResolvers` 缺失 → 揪出 `engines.node >=20` 是错的（见 §2.5） |
| `39628243240` | 改下界 `>=22` 矩阵 `[22,24]` | 两腿 success | 但仍有 4 条 annotation（含 2 条 actions 自身的 Node 20 弃用） |
| `39628634985` | actions 升 v7/v6 | **两腿 success** | annotation 降到 2 条（只剩 Ubuntu 26 迁移通知） |

### 5.3 tag 时点门禁（本提交树，本机 Node v24.15.0）

| 门 | 汇总行 | rc |
|---|---|---|
| `node --test` | `tests 107 / pass 107 / fail 0` | 0 |
| `pnpm lint` | 干净 | 0 |
| `node scripts/bench.js` | B1 7/7、B2 22/22、B3 4/4、B4 6/6、`ALL GREEN` | 0 |
| `node scripts/release-audit.mjs` | 111 文件 / 0 命中 → `DESSENSITIZE_AUDIT_OK` | 0 |
| `npm pack`（构建后） | **74 文件**，产物 `yuluo554-dsh-pipeline-0.2.1.tgz` | 0 |

### 5.4 tag 与 Release 附件（时点值）

- tag：`v0.2.1`（annotated），目标 = §5.1 的 CI 绿提交。
- 附件：`yuluo554-dsh-pipeline-0.2.1.tgz` + `SHA256SUMS`。
- `.tgz` sha256（**打 tag 前算定**，与附件逐字节同一份；大小 73,912 B）：
  `4a01247d1a6d7c7c58987f37ecbdddd9f400d0611b57e46640102f703993bde3`
- `SHA256SUMS` 自身 sha256：`71d433395c625ae24c1330294c5fdc50d0c2735f9e151d67a38624ece267d8bc`
  （格式：`<hash><两空格><文件名>`，单 LF 结尾，不带 `*`。）

> 注意：`.tgz` 是在**构建后**的工作树里打的（`lib/` 是 gitignored 构建产物，裸 clone 无 `lib/`，打出来会缺件）。
> 复现：`pnpm install --frozen-lockfile && pnpm build && npm pack`。

## 6. tag 后追加事实（打完 tag 才写，2026-10-21）

### 6.1 tag 落点

- `git rev-list -n1 v0.2.1` == `7ee20435ede5eee32096ae97186c840a13d3d180`，即 §5.1 里 CI 绿之后的**文档提交**；
  该提交自身的 CI run = **`39628977708`**（`ci (22)` / `ci (24)` 均 success，annotation 2 条 = Ubuntu 26 通知）。
- 代码/配置最后改动 = `1fd5791be21eda5b967b587663797b24ac6996ca`（run `39628634985` 绿）；
  其后提交只改 `plan/` 文档，不改任何门禁对象。

### 6.2 Release

- `gh release create v0.2.1`（非 draft、非 prerelease），最新 Release。
- 附件（`gh release view` 回读）：

| 附件 | size | GitHub digest |
|---|---|---|
| `yuluo554-dsh-pipeline-0.2.1.tgz` | 73,912 | `sha256:4a01247d1a6d7c7c58987f37ecbdddd9f400d0611b57e46640102f703993bde3` |
| `SHA256SUMS` | 98 | `sha256:71d433395c625ae24c1330294c5fdc50d0c2735f9e151d67a38624ece267d8bc` |

### 6.3 附件真下载复验 + 发布物自证

```sh
gh release download v0.2.1 --repo yuluo554/dsh-pipeline   # 到临时目录
sha256sum -c SHA256SUMS                                    # → yuluo554-…tgz: OK
sha256sum yuluo554-dsh-pipeline-0.2.1.tgz                  # → 4a01247d…（与 GitHub digest 一致）
```

**三方同值**：本地 `npm pack` 的值 = Release 说明里写的值 = GitHub digest = 真下载复算值。

发布物（`.tgz`）自证：

| 检查 | 结果 |
|---|---|
| 条目数 | **74**（`tar -tzf \| wc -l`），与 `npm pack` 一致 |
| 关键件 | `package/lib/index.js`、`package/lib/client.js`、`package/cordis.patch.yml`、`package/locale/{en,zh}.json`、`package/data/README.md` 齐全 |
| 泄漏 | `package/(plan\|test\|src)/` 命中 **0** |
| 包内 manifest | `name=@yuluo554/dsh-pipeline`、`version=0.2.1`、`engines={node:>=22, dsh:>=0.2.0-rc.1 <0.3.0-0}` |
| 包内 patch 说明符 | `name: '@yuluo554/dsh-pipeline'`（与包名一致） |
| 包内 client bundle | `window.__ModuleLoader__.load({ id: "@yuluo554/dsh-pipeline" …`（与包名一致） |
| 宿主机判定包内 manifest | `0.2.0-rc.1 / 0.2.1-rc.2 / 0.2.1 / 0.2.9` → **ACCEPTED**；`0.3.0-beta.1` → REFUSED（unmet 1） |
| 安装即用 | `pnpm add <tgz>` 进临时 profile → `import '@yuluo554/dsh-pipeline'` 成功（`name/inject/apply` 正确，`lib/` 预编译产物到位） |

> **口径说明（不夸大）**：上面「安装即用」是**脱离 dsh 宿主**的 Node 加载冒烟（在临时 profile 里装、import、
> 看导出契约），**不是** `dsh plugin add` 把插件挂进真实 profile 的端到端验收——那会改用户环境，
> 属未闭人工门（§4）。「宿主机判定包内 manifest」用的是 dsh 公开导出的判定函数，判的是本体（包内 package.json），
> 这一步可以算权威；「插件在真实 profile 里 enabled 且 web 面板有入口」仍待用户执行。

### 6.4 未闭事项（移交用户）

1. `npm publish --access public`（scope 包首发布；本仓 `.npmrc` 是 npmmirror 镜像，**发布须显式 `--registry=https://registry.npmjs.org`**）。
2. 真实 dsh 安装目检（唯一权威验收，会改 profile）。
3. `v0.2.0` 不存在（本仓 v0.2.1 是首个 tag），无旧 tag 需避让。