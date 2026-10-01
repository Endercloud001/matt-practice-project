# 深化 Instructor analytics dashboard 的客户端重试 module

日期：2026-09-30。类型：客户端架构深化与行为回归覆盖。本文自包含，可作为一个实现 Issue 的规格。

> 状态：已完成，保留为现有行为的规格依据，不作为 Ralph Loop 待办。2026-10-01 核查：[Issue #13](https://github.com/Endercloud001/matt-practice-project/issues/13) 已关闭，关联 [PR #14](https://github.com/Endercloud001/matt-practice-project/pull/14) 的实现已在 dev 分支。下文描述规格形成时的要求与调查事项；实现交付后的结论以提交、测试和 Issue 讨论为准。

## Problem Statement

Instructor 和 Admin 在 Instructor analytics dashboard 中需要独立重试失败指标，并知道哪些结果已经刷新、哪些仍使用较早的观察时间。切换 Course、日期或分页后，旧请求不得覆盖当前数据；学生名单发生变化或权限失效时，不能继续呈现已失效的名单。

当前卡片和学生表分别维护请求关联、响应接纳、局部覆盖与通知。共同规则分散，两处的防守细节不同，修改时序规则时需要同时理解多个 implementation。现有静态展示测试及内存路由导航测试覆盖部分展示行为，但不能证明 mounted React Effect 正确接纳、拒绝和去重重试回包。

本次目标是在保留现有产品行为、安全措施、服务端协议与并发能力的前提下，将共同复杂度集中到一个 deep module，并为真实 React 请求转换提供可重复的行为验证。这里没有声称已经发现迟到响应导致的数据泄漏缺陷。

## Solution

采用共享的客户端重试 hook。卡片独立持有单指标状态，学生表用一个实例持有两列状态；调用者描述业务目标与初始数据，hook 构造请求、核对响应、维护局部显示结果及观察时间。

页面继续负责路由初始快照上下文、全页忙碌汇总、单条通知及整页恢复。服务端继续负责 session、参数校验、事务内授权与读取。使用少量 DOM 集成测试驱动真实 hook 和 React Router，补足此前静态渲染未覆盖的时序行为。

## User Stories

1. As an Instructor, I want to retry one failed dashboard metric, so that other successful results remain available.
2. As an Admin, I want retries to retain the selected authorized scope, so that global access does not silently widen my selection.
3. As an Instructor, I want a Course metric retry to use the server-confirmed Course identity, so that a query override cannot change its target.
4. As an Instructor, I want each Course summary metric to retry its own Course, so that the overview selection cannot substitute another target.
5. As an authorized viewer, I want to retry a failed Student progress column, so that quiz results and student identities remain unchanged when membership still matches.
6. As an authorized viewer, I want to retry a failed quiz column, so that previously refreshed Student progress remains available.
7. As an authorized viewer, I want each refreshed metric or column to show its own observation time, so that independent retry does not imply a whole-dashboard refresh.
8. As an authorized viewer, I want genuine zero, empty, unavailable and read-failed states to remain distinct, so that missing data is not presented as measured performance.
9. As an authorized viewer, I want repeated clicks on one busy target to avoid duplicate requests, so that its lifecycle stays predictable.
10. As an authorized viewer, I want different metric cards to retain concurrent retry, so that independent recovery is not unnecessarily serialized.
11. As an authorized viewer, I want filters and pagination disabled during retry, so that conflicting submissions do not change the reporting population mid-operation.
12. As an authorized viewer, I want ordinary navigation links to remain usable, so that I can leave the current dashboard while a retry is pending.
13. As an authorized viewer, I want an old Course response ignored after navigation, so that current values and Student identities are not replaced by earlier data.
14. As an authorized viewer, I want returning to the same URL to create a distinct reporting generation, so that responses from an earlier visit do not apply.
15. As an authorized viewer, I want newly loaded initial data to replace old local overrides immediately, so that an obsolete result is not displayed for an extra render.
16. As an authorized viewer, I want Student identity hidden while changing Course or Instructor, so that a previous roster does not appear to belong to the new selection.
17. As an authorized viewer, I want Student membership changes detected before applying refreshed columns, so that values are not attached to an obsolete roster.
18. As an authorized viewer, I want revoked access or a missing Course to require whole-dashboard recovery, so that failed authorization never becomes a harmless-looking empty metric.
19. As an authorized viewer, I want membership, access and missing-Course recovery explanations distinguished, so that I understand why reloading is necessary.
20. As an authorized viewer, I want malformed current responses to preserve earlier values with a safe failure explanation, so that invalid data does not overwrite valid results.
21. As an authorized viewer, I want uncorrelated responses ignored, so that an unidentified payload cannot trigger an incorrect authorization recovery.
22. As a keyboard or screen-reader user, I want one updating status and one effective completion notice, so that repeated Effects do not announce the same result repeatedly.
23. As an authorized viewer, I want the latest accepted completion notice after all retries finish, so that concurrent results have a predictable single status message.
24. As an authorized viewer, I want Student retry requests to omit names and emails, so that recovering numeric columns does not unnecessarily transmit identity data.
25. As a maintainer, I want request construction and response acceptance behind one interface, so that changing common retry rules has locality.
26. As a maintainer, I want typed metric and Student-column calls, so that invalid target and initial-data combinations are rejected before execution.
27. As a maintainer, I want to test through the same seam used by callers, so that tests survive changes to internal storage and Effect organization.
28. As a maintainer, I want real mounted React tests with controlled response order, so that late, duplicate and concurrent responses have repeatable regression coverage.
29. As a maintainer, I want existing authorization and route tests retained, so that client deepening does not remove established safety coverage.
30. As a maintainer, I want missing-correlation completion behavior explicitly investigated, so that an unproven assumption does not silently change server protocol or client safety.

## Implementation Decisions

### 已确认的范围与 module 形状

- 只深化客户端。现有两个 retry endpoint、session/redirect、参数校验、授权、数据库读取与响应组织保持不变。
- 保留产品行为，逐项落实 implementation 差异；不以统一 interface 为由删除 requestId、generation、scopeKey 或学生名单核对。
- 使用一个共享 hook，建议名称 useAnalyticsRetry。每个指标卡一个实例；学生表一个实例维护两列及各列观察信息。两个类型重载共享 lifecycle implementation，不复制两套重试逻辑。
- 调用者与 mounted hook 的业务 interface 是主要 seam。调用者只描述目标、消费显示结果及发起操作；requestId、scopeKey、回包处理步骤和 override 存储留在 implementation 内。
- 页面保留 generation、navigation/retry 汇总、禁用筛选与分页、单条通知及整页恢复职责，不新增页面目标注册系统或集中保存所有结果的协调器。

### Interface 的业务信息

- 单指标输入：显式页面或 summary 目标、metric 名称及显示标签、初始指标/asOf、页面 context。页面目标明确区分 overview 与服务器确认的 Course；summary 目标提供当前行的 Course ID/名称。
- Student 输入：列目标、当前初始名单/asOf、页面 context。一个实例接受按列重试，维护 Student progress 和 quizAverage；不把两列拆成独立请求状态实例。
- context 提供当前 generation、导航状态、全页 retryPending 及事件接收入口。通知与恢复事件都携原请求 generation，页面接收时再次核对，不让最新回调闭包把旧事件归到新页面。
- 单指标返回当前可显示的指标/asOf、busy/disabled 和零参数 retry。Student 返回已合并到当前名单的双列结果、各列 asOf/refreshed、activeMetric、busy/disabled 和按列 retry；调用者不再按 ID 查询或合并 override。
- 视图明确区分 ready 与 reload-required。ready 只表示可以展示，指标自身仍可为 error/read_failed；恢复分支不携指标或 Student 身份数据。
- 从既有领域类型推导目标和结果类型，拒绝 Student 使用购买指标、Course 缺 ID、summary 使用 quiz 指标，以及 overview 使用 Course 专属 quiz 指标。遵循项目类型规范，不使用 any，不增加假想通用 builder/parser/merger 或公开 transport port。

### 保留请求与 scope 行为

| 目标                  | 请求构造与关联规则                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| Overview 指标         | 保留原始页面查询参数，包括原有分页参数；使用既有单指标 endpoint                                             |
| Course 指标           | 在原始参数上以服务器返回的 Course ID 覆盖 courseId；不从 URL 猜测已授权身份                                 |
| Course summary 行指标 | 仅保留 range/start/end/instructorId/courseId，再覆盖当前行 Course ID；不携带分页                            |
| Student 列            | 保留原始参数并覆盖快照 Course ID/studentPage；使用既有学生列 endpoint，scopeKey 保持原始 pathname 加 search |

单指标 scopeKey 仍按既有查询串规则与回包匹配；Student scopeKey 仍按现有路径加查询串规则匹配。保留现有 requestId 生成方式。这些字段用于响应关联，不充当服务端授权凭证；Student 初始名单中的姓名/email 不序列化进请求。

### 响应接纳与观察时间

- 同一实例不能重入。重试操作自身检查状态，阻止 React 尚未重渲染时的第二次同步调用，不能只依赖按钮 disabled。
- 完成且仍属于当前上下文的请求才可接纳。检查 generation、requestId、实际 scope 和目标；旧请求、旧 generation 或不匹配 scope 不覆盖结果、不通知、不触发恢复。
- generation 不变但目标分支、metric、Course、实际 scope 或 Student 名单/分页身份变化时，旧请求和覆盖同样失效。label、Course 名称、Student 姓名/email 或等值对象引用变化不单独使覆盖失效。使用普通字段比较，不增加 hash。
- 新 generation 或新目标在当前 render 使用新的 initial，不能依赖后续清理 Effect 才撤销旧值。导航过程中原有 Updating 展示与跨 Course/Instructor 隐藏名单规则保留。
- 已关联的合法失败分支先于成功 payload 校验处理；失败响应不一定包含成功 metric 字段。forbidden/not_found 走整页恢复；Student invalid_page 或名单不匹配同样恢复。
- 成功 payload 检查 metric、指标/列数据形状及可解析的 asOf；Student 还比较 Course、page/pageSize、totalCount/totalPages、行数及有序 Student ID。
- 同一完成请求最多一次应用与事件。归属确认后、发送事件前记录处理状态；回调引用更新、重新渲染和 StrictMode 重跑不重复通知。
- 独立重试只改变该指标/列的结果和 asOf。其他结果与时间保留；合法 error/read_failed 是指标状态，不等于整个请求未授权。
- 已证明属于当前请求的无效 payload 保留先前值，结束忙碌并给出安全局部失败提示，不应用部分数据或伪造成功时间。
- Student 身份字段始终来自当前 initial，只合并通过名单核对的数值结果。refreshed 表示当前代接受过该列结果，不能仅以 asOf 不同推断。
- HTTP 重定向、session 到期及 loader 抛错沿用 React Router 路由处理，不增加将所有异常转成指标空值的捕获逻辑。

### 保留并发与通知

| 当前操作       | 继续允许               | 禁用入口                                                |
| -------------- | ---------------------- | ------------------------------------------------------- |
| 指标卡重试     | 其他卡片重试、普通导航 | 当前卡片重试、筛选、Course/Student 分页、Student 列重试 |
| Student 列重试 | 卡片重试、普通导航     | Student 两列重试、筛选、Course/Student 分页             |
| 页面导航       | 普通导航按既有路由处理 | 重试、筛选和分页；跨 Course/Instructor 不显示旧名单     |

busy 表示本实例进行中；disabled 表示入口能否发起。全页 retryPending 只限制 Student 发起，不能作为响应接纳条件；Student 完成时其他卡片仍忙也必须能接纳合法结果。

页面任一重试忙碌时显示 Updating；空闲后显示当前 generation 最近一次有效完成的单条通知。“最近”按客户端接纳顺序，不按服务器 asOf 排序，不新增批次摘要。通知标明目标、刷新时间及其他指标仍保留原观察时间；整页恢复优先。

### 整页恢复

当前 generation 中的授权/存在性错误或 Student 名单/分页不匹配阻断整个 dashboard。恢复期间不继续携带或显示失效名单；保留现有恢复导航和日期保留行为。准确区分授权失效、Course 不存在和名单变化，不将名单变化解释为已经发生授权拒绝。

## Testing Decisions

### 测试 seam 与现有经验

- 主要 seam：实际业务调用者与共享 mounted hook。沿用已确认的测试决定，使用现有 Vitest、React/React DOM 与少量 jsdom DOM 集成测试；只为相关测试选择 DOM 环境，不整体迁移测试环境。
- 测试通过真实内存 Router 与可控 loader Promise 调整完成顺序，使用 React act 处理更新。断言显示值、观察时间、入口状态、通知及恢复；不读取内部 state，不断言随机 requestId 完整字符串。
- 既有 dashboard 静态展示测试和内存路由 pending-navigation 测试是展示与导航的经验；它们不能代替 mounted Effect 时序测试。保留有价值的现有覆盖，仅在相同行为确实被替代时删除重复断言。
- 既有 retry loader 测试和真实测试 SQLite 的事务/授权测试继续保留，包括 role、ownership、日期、删除、学生身份范围及重试重新授权。不为本次深化增加新的数据库连接或纯算式测试 seam。
- 真实浏览器验收继续验证键盘/屏幕阅读器提示、混合观察时间及恢复流程；DOM 模拟不能单独证明真实浏览器可访问性。
- 安装 jsdom 前核对现有 Node/Vitest 的兼容版本。实现过程中运行相关类型检查与测试，最终运行项目要求的完整检查与针对性浏览器验收。

### Acceptance Criteria

- [ ] 页面指标、Course 指标、summary 行和 Student 列都通过共享 hook，调用者不再构造 retry URL/scopeKey、核对 requestId 或合并回包 override。
- [ ] 类型拒绝不支持的目标/metric/初始数据组合；恢复视图没有指标值或 Student 身份字段。
- [ ] 四类请求保留既有参数和 scope 规则；summary 不携分页，Student 不发送姓名/email，服务端协议不变。
- [ ] 一个指标刷新只改变自己的值/asOf；Student 两列依次刷新后均保留各自结果、asOf/refreshed 和正确更新提示。
- [ ] 同一目标两个同步 retry 调用只发送一次请求；忙碌、导航或恢复期间不能重入。
- [ ] 不同卡片仍可并发；卡片和 Student 列的非对称禁用、筛选/分页禁用及普通导航行为与规格一致。
- [ ] Student 列完成而其他卡片仍 pending 时，合法 Student 结果被接纳；全页 retryPending 不阻挡完成处理。
- [ ] 两卡片反序完成都独立更新；期间 Updating，结束后单条提示对应最近接纳的完成，说明混合观察时间。
- [ ] 换 Course/Instructor 时旧名单隐藏；同 Course 原有更新中展示保留，并正确标注旧结果。
- [ ] 换 Course、同 URL 再次进入或获得新初始 asOf 后，旧回包不覆盖值、不通知、不触发当前页恢复。
- [ ] 同 generation 下切换 metric、Course 或目标，旧覆盖不继承；label 或等值对象引用变化不重置。
- [ ] 新初始快照在当前 render 生效，不出现等待清理 Effect 才撤销旧结果的中间显示。
- [ ] 重复完成回包、重新渲染、回调引用更新和 StrictMode 重跑不重复应用或通知。
- [ ] 已关联但 metric/result/asOf 不合法的回包保留旧值，安全局部失败且忙碌结束；合法 error/read_failed 保留其指标语义。
- [ ] 匹配当前请求的 forbidden/not_found 和 Student invalid_page 被正确处理，不因缺少成功 metric 字段而被忽略。
- [ ] Student ID、顺序、Course 或任一分页/人数信息不匹配时不合并列结果，整个 dashboard 进入准确说明原因的恢复流程。
- [ ] 恢复视图不携带可显示的失效名单，恢复通知优先于普通刷新通知；恢复导航沿用现有行为。
- [ ] 缺关联字段的完成、旧 fetcher.data、取消、重定向和 React commit 时序按 Further Notes 验证，并记录客户端归属证据或未能证明的限制。
- [ ] 现有相关 route/SQLite 安全覆盖继续通过；不得通过删除 requestId/generation/名单检查来通过新测试。
- [ ] 有针对性的真实浏览器验收证据，覆盖重试、键盘/状态提示、混合时间、导航隐藏名单及恢复。

## Out of Scope

- 修改服务端 retry endpoint、参数/响应协议、session/authentication、授权规则、事务或数据库 schema。
- Student progress 算法深化、其他架构候选、增加新指标或更改数值与日期口径。
- 全页串行重试、批次通知、名单变化只隐藏 Student 表、自动轮询或自动重试。
- 通用 transport framework、目标注册系统、假想可替换 adapter、公开 build/parse/merge 回调。
- 新增 hash、冻结 contract、baseline、gate 或新的快照持久化设施。
- 将整个测试集改到 DOM、建立通用端到端平台、删除已有安全覆盖。
- 部署或正式发布；本 Issue 完成的是客户端实现、集成、验证与审查。

## Further Notes

### 必须验证：无关联字段错误回包的归属

既有单指标 route 的部分 invalid_query 响应没有 requestId/scopeKey；Student route 的相应响应回传关联字段。缺字段不能被静默视作当前请求，也不能将 fetcher 空闲或残留 data 当作归属证明。

实施时在真实 Router DOM 测试中区分：

1. 当前请求的匹配 envelope，成功内容不合法：安全局部失败，不覆盖先前值。
2. 明确属于旧 requestId、不同 scope 或旧 generation：忽略结果与通知。
3. 缺关联字段：若本轮 Router load 完成及当前请求记录能够证明来源，才发出无数据覆盖的安全局部失败；无归属证明时不应用、不声称刷新成功，也不触发授权恢复。

已观察到当前 React Router 的 load implementation 等待本轮读取，但完成 Promise 不返回响应。仍需验证取消/重定向、React commit 与残留 data 的关系；这项观察不是已经通过的行为测试。

优先在实现早期用上述 DOM seam 验证该路径。若客户端无法证明归属，且要满足“一切无关联完成都必须通知失败”需要改服务端，应记录具体证据并提出范围/行为取舍，不能自行修改协议或降低安全检查。Issue 可执行的要求是验证和报告这一情形；尚未承诺未经验证的归属能力。

### 规格编写时的设计与实现状态

九项决定与 interface 校验形成本文的设计依据。规格编写时已有 TypeScript 草案及三种调用示例做过静态校验，共享 hook、DOM 集成测试及浏览器行为当时尚未实现；后续实现状态见本文顶部。本文提供全部实现行为与验收信息，不要求执行者依赖未被 Git 跟踪的本地访谈资料。
