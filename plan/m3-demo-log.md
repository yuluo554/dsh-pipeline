# M3 演示证据 —— Web 半编辑器(2026-09-28)

> 全程零手写 JSON:浏览器端编辑器经 `/api/dsh-pipeline/*` 路由保存、校验、读回。
> 环境事实:DEEPSEEK_API_KEY 未配置(三代在线冒烟欠账,M2 HANDOFF 待决问题 2),
> 因此「运行」链路演示到引擎边界 —— 运行页 → POST /run → resolveAgent →
> runPipeline → 真实 worker 引擎;无 key 时子 agent 失败会以可读错误返回运行页
> (这正是 fail-loud 设计的展示)。在线全链路留待 key 配置后人工补跑。

## 1. 离线全绿门(改口径前对照:本里程碑未动任何冻结口径,基准原样重跑)

```
pnpm test  → 80/80(新增 form-model 9 例 / web 路由 11 例 / client bundle 冒烟 1 例)
pnpm lint  → host + client 双 tsconfig 全绿
pnpm bench → B1 7/7 byte-exact · B2 22/22 · B3 4/4 · B4 6/6 = ALL GREEN
```

M3 DoD 的两条离线硬门(test/form-model.test.js,对全部 7 份 fixtures 断言):

- **编辑产物 validateDef 全过**:每个 fixture 走 def→form→def 后 validateDef 深等 `{ok:true}`;
  保存路由(`/save`)服务端再过一次 validateDef + `buildIR` 语义预检(环/未知变量/闸门)
- **与手写 JSON 双向一致**:round-trip deep-equal 逐 fixture 通过;且 canonical 字节
  (`JSON.stringify(def,null,2)+'\n'`)与 fixture 文件逐字节相同(为此 schema/form-model 的
  装配统一为 schema 文档字段序 id,label,prompts,model,skills,tools,dependsOn,
  outputSchema,failurePolicy,retry)

## 2. 实机装载(web profile,后台 `--no-open --port 3095`)

```
[dsh-pipeline] tool registered: pipeline_hello
[dsh-pipeline] 0.2.0 entry registered: /pipeline command + pipeline tool
[dsh-pipeline] self-test replied: [{"type":"text","text":"Hello, dsh-pipeline! (dsh-pipeline)"}]
dsh web: http://127.0.0.1:3095/?token=…
```

- `did not activate` 计数 = **0**(grep -ci 实测),M2 纪律保持
- 启动图:`GET /`(带认证 cookie)的 `__DSH_BOOT__` 含
  `"id":"dsh-pipeline","url":"/plugins/??dsh-pipeline/client.js&rev=…","inject":["@deepseek-ai/dsh-client-locale"],"external":["@deepseek-ai/dsh-client-locale"]}`
  —— client-modules 组合阶段接受了本插件的 dsh.client 声明,并把 locale bundle
  按 inject 序排在同一 combo row 内
- bundle 可服务:`GET /plugins/??dsh-pipeline/client.js&rev=…` → 200,47 KB,
  内容即 `window.__ModuleLoader__.load({id:"dsh-pipeline",factory:(require)=>{…}})` 格式,
  require 白名单扫描仅 react / react/jsx-runtime(平台种子表)

## 3. store RPC 实机链路(经真实浏览器认证栅栏,cookie 认证后 curl)

```
GET  /api/dsh-pipeline/inventory → {"pipelines":[],"skills":[],"tools":[pipeline_hello,pipeline,…],"provider":"spawn"}
GET  /api/dsh-pipeline/catalog   → {"default":{"provider":"deepseek-official","model":"deepseek-flash"},…}  (真实模型 catalog)
POST /api/dsh-pipeline/save      → {"ok":true,"json":"{ … }"}   (零手写 JSON 写入)
GET  /api/dsh-pipeline/def?name=smoke-demo → 原文读回,与落盘文件逐字节一致
```

落盘文件 `工作区/.dsh/pipelines/smoke-demo.json` 保留作证据;
`inventory` 在 pipelines 目录缺失时返回空列表(M3 实测暴露并修复的跨副本 instanceof 坑,见 HANDOFF-M4)。

## 4. client 半运行时冒烟(test/client-bundle.test.js)

在 Node 侧以 `window.__ModuleLoader__` 垫片 + react 种子映射执行**已构建的 lib/client.js**:
工厂执行无崩溃;exports = {name, inject:['slots','locale'], apply};apply 对 stub 服务完成
`settings.section`("pipeline")与 `conversation.session.header.actions`("pipeline-run")
两席位注册;zh/en 双字典注册通过 ctx.effect(卸载随 fiber 撤销)。

> 浏览器 GUI 级验证(设置弹层内编辑器的排版、会话头按钮点击、弹窗交互)未完成:
> 本机 agent-browser/CDP 启动 Chrome/Edge 均复现 "Chrome exited early … DevToolsActivePort"
> (多参数组合 --no-sandbox/--user-data-dir/--headed 与 Edge 可执行文件均失败,环境性损坏)。
> 该验证列入 HANDOFF-M4 人工冒烟清单;组合层 + 路由层 + bundle 执行层证据已如上留档。
