# HANDOFF —— 跨会话交接快照（M4 起续接）

> 填写纪律：只写实测过的内容；环境坑必须带复现与解法；敏感字面值用占位符。

## 当前进度

- 里程碑：M3（已完成于 2026-09-28）
- 工作区：`D:\ProgramData\zcode\dsh-1\dsh-pipeline`；git：本地 `main` 无远端，M3 收尾后待提交（第四个提交）
- 上游调研：`D:\ProgramData\zcode\dsh-1\dsh-plugin-research`（07 号可行性报告 + official-docs 存档；
  client 面 API 本里程碑以**本机安装的 dsh 0.1.5-rc.1 包源码/bundle** 为准逐条实测，存档未覆盖）
- 插件状态：**0.2.0 已 link 进本机 web profile 且激活验证通过**（`did not activate` 计数 0；
  bundle patch 继续启用引擎；host lib 与 client bundle 重建后重启 dsh 即生效）
- 演示证据：`plan/m3-demo-log.md`（DoD 双门测试 + 启动图/bundle/API 路由实机留证 + bundle 运行时冒烟）
- 测试：80/80 全绿（新增 form-model 9 例、web 路由 11 例、client bundle 冒烟 1 例）；B1-B4 ALL GREEN（口径未动）

## 下一里程碑待办（plan/05 M4，运行视图 + 成本徽章）

- [ ] 【串行】`pipeline-run` ConversationNodeDefinition（keyed renderer，订阅 `workflow/*`，节点链状态徽章）
  - 参照：`@deepseek-ai/dsh-client-ui-workflow-run` 包（本机 `~/.dsh/profiles/node_modules/` 可读源 bundle 与类型）
    + `dsh-client-ui-conversation` 的 `ctx.uiConversation.events.register(def)` 契约（deliverables 的
    `deliverablesDefinition` 是活的对照样例）；会话头席位同款注入手法已在 client/index.tsx 落地
- [ ] 【串行】每节点耗时/token 聚合（`workflow/agent-start/end` 时间差 + session 统计）
  - 宿主事件面：`workflow/*` 为只读快照 emit；转发到浏览器走 `dsh-api-remotes` 的 `API_REMOTE_FORWARDED_EVENTS`
    白名单（需要确认 workflow/* 是否已在名单内——不在则 M4 的浏览器侧订阅须先解决转发通路，勿想当然）
- [ ] 【并行】运行入口页 → 运行卡接线：RunAction 的 POST /run 返回摘要仍保留，运行卡负责会话流内实时状态
- **演示物**：聊天中实时看到节点状态流转；双模型成本对比徽章
- **DoD**：事件断连/重连后卡片不脏渲染；回写 plan/00、06，写 HANDOFF-M5

## M3 收尾欠账（人工门清单，M4 顺手补）

- [ ] **浏览器 GUI 冒烟**（M3 偏差 #2）：本机 CDP 启动损坏（见环境坑 #1），换环境/手工浏览器验证：
  设置 → 流水线区渲染（列表/表单/保存/校验）、会话头"流水线"按钮 → 弹窗 → 选流水线运行
- [ ] **在线冒烟**（M0/M1/M2/M3 四代合并欠账）：`DEEPSEEK_API_KEY` 配置后按 plan/04 口径人工跑
  `three-node-two-models.json`；M3 增补两条在线路径——① 运行页发起同一定义；② 编辑器新建 → 保存 → 运行全链
- [ ] skills 在线验证（M2 顺延）：真实 `ctx.skills`（skill-filesystem）链路 + 编辑器技能多选真实数据展示
- [ ] dsh 升级决策（M2/M3 连续顺延，用户口头许可仍在挂）：0.1.5-rc.1 无 agent() toolFilter → FR-11 维持闸门；
  升级 = 重锚 13 依赖 + 全量重核 + 重跑基准；0.1.7 引擎若支持 toolFilter/effort 则编辑器三个只读字段可解封

## 既定口径清单（M3 期末冻结；动了会打挂基准——改前对照，改后重跑 B1-B4）

1. IR/编译器/runner 全部 M2 口径原样未动（见 HANDOFF-M3 清单 1-8，此处不重复）；B1-B4 重跑 ALL GREEN
2. **装配字段序冻结**（M3 新增）：schema.validateNode 与 form-model.nodeFromForm 以 schema 文档字段序
   id/label/prompts/model/skills/tools/dependsOn/outputSchema/failurePolicy/retry 装配（spread 保序，
   **禁止事后赋值重排**——对象字面量先建 prompts 再赋 label 会把字节序打乱，实测踩过）；store.saveDef 落盘字节
   = `JSON.stringify(def,null,2)+'\n'`，对 7 份 fixtures 逐字节复现（test/form-model.test.js 断言）
3. **form-model 双向等价语义**：往返深等 + 退化空对象（model:{}/options:{}）归一为缺省；
   dependsOn 缺省 vs 显式（含 `[]`）由 hasExplicitDeps 保留（IR 规则 1 语义分界）；闸门字段
   （tools/reasoningEffort/maxAgentsPerNode）编辑器只读、round-trip 无损（plan/06 M3 决策行）
4. **client bundle 契约**：`window.__ModuleLoader__.load({id,factory})` 懒 CJS；external 白名单 =
   平台种子表（react/react/jsx-runtime/react-dom/react-dom/client/@deepseek-ai/cordis/dsh-client-store/
   dsh-client-ui-slots/dsh-client-ui-primitives/dsh-client-ui-dockkit）+ dsh.client.external（现仅 locale 包）；
   scripts/build-client.mjs 构建后扫描 require 白名单；**新增浏览器依赖必须三处同步**（package.json
   dsh.client.external+inject、build-client.mjs SEED_MODULES、client/ambient.d.ts 类型 import）
5. **web API 面冻结**（M4 运行卡消费方）：/api/dsh-pipeline/{inventory,def,validate,save,catalog,run}；
   统一 `{error}` 4xx/5xx + 业务结果 200；run 请求体 {name,input,sessionId}，request.signal 即取消通路
6. **依赖锚定 M3 修订**（口径 7 扩容）：原 10 + worker-thread 之外新增 8 个 client 面 0.1.5-rc.1
   精确锚定包（connection/api-session-controller/session/.locale/.ui-renderer/.ui-settings/.ui-conversation/.ui-slots），
   全部 type-only 消费；devDep 另加 esbuild/react(仅测试)/@types/react
7. **浏览器侧类型纪律**：ctx.slots/ctx.locale/SlotMap 席位键一律经官方包 d.ts 声明合并
   （ambient.d.ts 的 4 个 `import type {}`）；**用户空间 `declare module '@deepseek-ai/cordis'` 禁用**
   （会遮蔽 star-re-export 的 Context，实测踩坑）；client tsconfig lib 必须含 ESNext（Disposable 族）
8. 测试全离线（含 client bundle 的 Node 垫片执行冒烟）；在线冒烟仅人工门；M0 自检行为保留

## 本机环境坑（M3 新增实证；只写实测过的）

1. **浏览器自动化损坏（未解决）**：agent-browser 0.27.0 启动 Chrome/Edge 均复现
   `Chrome exited early (exit code: 0) without writing DevToolsActivePort`；--no-sandbox、
   --user-data-dir 全新目录、--headed、AGENT_BROWSER_EXECUTABLE 指 Edge 全部一致失败；
   taskkill 残留 chrome.exe 后重试仍复现 → 判定为机器级环境问题，勿再按同路径重试；
   M4 GUI 验证请直接换手工浏览器或另寻环境
2. **插件与宿主各解析一份 npm 包副本，`instanceof` 跨接缝失效**：dsh-fs 的 FsError 实测跨副本
   instanceof 为 false（stub 测试测不出——两侧同副本），store.isMissing 已改按 `err.code` 判别；
   同类坑预警：runner/errors 层任何"类型 instanceof 判别"在实机接缝上都不可靠，用 code/字段判别
3. **用户空间增强遮蔽 Context**：`declare module '@deepseek-ai/cordis'` 在插件侧会遮蔽而非合并
   star-re-export 的 Context（表现为 `ctx.effect` 报"静态成员"假错）；官方包 d.ts 的内部增强
   （相对 specifier）不受影响——接入方式见 client/ambient.d.ts
4. **client tsconfig lib 必须 ESNext**：lib ES2020 + skipLibCheck 会吞掉 cordis d.ts 内部错误，
   导致 `ctx.effect` 类型解析假错（Error 类型族缺失）
5. 沿袭 M2/M1/M0：web profile 引擎默认禁用（patch 已兜）；`dsh --help` 验装捷径失效；
   Git Bash 下 node -e 里 `/c/...` 路径不可用；`python` 是商店 stub；后台 dsh 冒烟进程清理用
   powershell `Get-CimInstance` 按 CommandLine 匹配找 PID 再 Stop-Process
6. **dsh-client-ui-slots 在 profile node_modules 的符号链接是悬空的**（指向 npm 全局 dsh 包内
   不存在的路径）——读它的类型请用仓库 node_modules 的 pnpm 副本（pnpm add 后可用），
   勿依赖 profile 内路径

## M3 DoD 逐项 checklist（来自 plan/05，全部留痕）

- [x] 【串行】client 半骨架：package.json `dsh.client`（platform web + locale inject/external）+
  `./client` 导出 + esbuild 构建 preset（scripts/build-client.mjs）+ tsconfig.client 分立
- [x] 【串行】store RPC + 列表/表单编辑器：host web.ts 六路由 + client api.ts + PipelinesSection
  （模型下拉读 catalog、技能读 ctx.skills、工具读 ctx.tools 只读）
- [x] 【并行】运行入口页：RunAction（会话头席位，sessionId 标准注入，选流水线+输入+运行+取消）
- [x] DoD：编辑产物 `validateDef` 全过（7 fixtures × {form→def→validateDef 深等 ok} + /save 服务端
  validateDef+buildIR 复检）
- [x] DoD：与手写 JSON 双向一致（7 fixtures 往返深等 + canonical 字节逐字节复现）
- [x] 回写 plan/00、03、06 + README 状态行 + 本 HANDOFF
- [ ] 浏览器 GUI 级验证（环境损坏，列入 M4 人工冒烟清单——M3 偏差 #2 替代验证已留档）

## 关键命令速查

```sh
# 安装到本地 dsh（在仓库父目录 dsh-1/ 执行；开发回路）
dsh plugin --profile web add ./dsh-pipeline
dsh --profile web --dump-config          # 验证层挂载 + 引擎已启用（grep workflow-worker-thread）
dsh --profile web --no-open --port 3095  # 后台启动；apply 日志 = 装载证据（约 13 秒）
dsh plugin --profile web remove dsh-pipeline

# 基准与测试
pnpm install && pnpm build && pnpm test  # 离线测试（B1-B4 断言 + 真实引擎 + form-model/web/client-bundle）
pnpm bench                               # B1-B4 指标表（ALL GREEN 门槛）
pnpm lint                                # host + client 双 tsconfig
node scripts/build-client.mjs            # 仅重建浏览器 bundle（build 已含）

# 实机 API 冒烟（token 从启动日志取；cookie 交换后携带）
# GET  /api/dsh-pipeline/inventory
# GET  /api/dsh-pipeline/def?name=<n>
# POST /api/dsh-pipeline/validate | /save   （body = 定义 JSON）
# GET  /api/dsh-pipeline/catalog
# POST /api/dsh-pipeline/run               （body = {name,input,sessionId}）
```
