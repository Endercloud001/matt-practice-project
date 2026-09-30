# 客户端 analytics retry 验收记录

日期：2026-09-30。实现依据：[Issue #13](https://github.com/Endercloud001/matt-practice-project/issues/13) 和同目录的 `deepen-Instructor-analytics-dashboard-spec.md`。

## 实现与范围

- `useAnalyticsRetry` 的两个业务重载共享请求生命周期。每个卡片独立保存指标；学生表单实例保存两列及各自的观察时间。
- hook 内部构造四类 scope，接纳完成回包、核对身份、合并数值和去重事件。页面接收带原 generation 的事件，再次核对归属，维护单条提示和整页恢复。
- 保留两类 endpoint、服务端协议、授权、数据库读取和原有并发能力；没有新增 hash、冻结 contract 或目标注册系统。原工作区 `.gitignore`、`CONTEXT.md`、本地 skills/AGENTS 与原 PRD 保留。
- 恢复标题区分授权变化、课程不存在、学生名单变化。指标卡补上原先未渲染的 `asOf`，显示该卡片自身的 UTC 观察时间，满足 PRD 对混合快照的可见性要求。

## 无关联字段回包的归属

使用 React Router 7.12.0、React 19.2.4、Vitest 3.2.4、jsdom 27.4.0，在真实 mounted React 和内存 Router 中验证：

1. 初次 idle 不产生完成事件；第二次请求 pending 时保留的旧 `fetcher.data` 不产生完成事件。
2. 本轮 `fetcher.load()` 的 Promise 完成后，React Effect 可以观察到本轮新 `invalid_query` 数据，即使该数据没有 requestId/scopeKey。Promise 自身不返回响应。
3. 离开视图后，旧请求仍可能完成；卸载不保证 HTTP/loader 已取消。因此 Promise 完成不能单独证明当前视图归属，仍需 mounted、当前 attempt、generation、目标身份以及导航状态核对。
4. session 重定向由 Router 导航；loader 抛错进入 Router error boundary，不转成空指标。
5. 同一 fetcher 发起后续 load 时，前一请求的 `Request.signal.aborted` 确实变为 true。故意延迟被取消 loader 的完成，其无关联授权错误与 retained data 均不被认作当前完成；只有活动请求完成后的新 invalid_query 数据被接纳为局部失败来源。

实现只对完成、仍属于当前上下文且有新 data 的请求给出安全局部失败。缺字段不会应用数值，也不会触发授权恢复。明确错误的 requestId/scopeKey 直接忽略。保留的旧 data 和无法证明归属的数据不产生成功或恢复提示。

限制：这不是对所有 Router 版本的保证。若完成后 data 与请求前完全相同，客户端没有足够证据证明是新 payload，保守忽略；没有更改服务端协议来强制所有无关联完成都产生失败提示。

## 自动化覆盖

新增三个仅使用 jsdom 的测试文件，其他测试仍沿用原环境：

- Router 归属探针：完成、旧 retained data、真实取消后的迟到完成、离开和重定向。
- 业务 hook：类型拒绝错误组合、同步重入、StrictMode、缺字段/无效/旧回包、四种 scope、指标状态、目标与快照切换、当前身份更新和双列独立时间。
- 实际页面 DOM：反序并发、非对称禁用、单条提示、学生先完成、混合时间、整个 dashboard 恢复、全部名单/分页比较字段、跨 scope 隐藏名单、同 scope 更新、redirect/error boundary 和局部失败保留之前的列。

原有卡片/页面/表格展示测试以及两个 retry route 的授权测试继续保留并通过。最终类型检查、全量测试和审查结果记录于实现提交与交付说明。

独立 code review：Standards 审查未发现问题；Spec 审查提出一个取消验证缺口，已补充上述真实取消场景并通过。生产代码未因该补充改变既有决定。

## 真实浏览器

Chromium 148.0.7778.96，桌面 1280 × 900 与移动端 390 × 844。使用临时 Vite 客户端 fixture harness，挂载实际 `AnalyticsPage`、卡片、筛选和学生表，加载项目真实样式，并以受控 Router loader 调整回包顺序。没有修改或填充实际工作区数据库。

通过以下六组针对性验收，未出现 pageerror：

1. 键盘 Enter 发起重试；两卡片反序完成；单条 polite live status 以接纳顺序显示完成提示，即使最后完成者的 asOf 更早；卡片分别显示自己的时间。筛选和分页禁用，普通导航保留。
2. 学生 progress 在卡片仍 pending 时成功；随后 quiz 列刷新，progress、身份和两列 UTC 时间保留。移动端学生表可聚焦，用右箭头水平滚动。
3. 名单不匹配移除整个 dashboard 和身份信息，显示准确原因。恢复链接保留既有日期参数，可通过键盘 Enter 执行整页重新加载。
4. 不携成功 metric 的 forbidden、not_found、invalid_page 分别进入准确解释的整页恢复。
5. 切换课程期间立即隐藏旧名单；迟到授权回包不触发新 scope 的恢复。
6. 同课程导航保留旧结果和 Updating 说明。

临时 harness、运行 JSON 和截图位于被忽略的 `docs/analytics-retry-browser/`，不作为新的端到端平台加入生产代码。该浏览器验收验证客户端交互；服务端安全由既有真实 SQLite/route 测试验证。已检查键盘与 live-region DOM 语义，未进行 NVDA/VoiceOver 人工听读。
