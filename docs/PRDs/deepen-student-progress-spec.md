# 深化 Student progress 读取 module

> 状态：已完成，保留为现有行为的规格依据，不作为 Ralph Loop 待办。2026-10-01 核查：[Issue #16](https://github.com/Endercloud001/matt-practice-project/issues/16) 已关闭，相关实现提交 `48eb75a` 已在 dev 分支。下文的调查描述保留规格形成时的语境；当前实现与验证结果以该提交、测试和 Issue 讨论为准。

## Problem Statement

Instructor analytics dashboard 的 Overview、Course summaries 和 Student snapshots 分别实现了相同的 Enrollment 人群、lesson 归属和完成记录去重规则。维护者修改规则时需要同步三处 implementation；仅更新其中一处可能让同一组数据在不同视图中产生口径漂移，相关测试也分组维护。

当前没有证据证明正常数据下已经发生漂移。本次解决的是规则重复导致的维护风险，并保持已有产品语义和公开返回结构。一个已由代码推导出的特殊行为必须保留：无有效 Enrollment 或无 lesson 与完成表故障同时发生时，三个入口的状态不同，不能在重构中顺带统一。

## Solution

在现有 analytics module 内深化 Student progress 的读取 module，集中有效人群、lesson 分母、去重完成数、聚合及状态规则，提供 Overview、Course、Student 三种明确口径的进度结果。

Instructor 和 Admin 继续获得相同的进度、分页、授权范围和故障状态；维护者只需在共用事实读取 implementation 中维护规则。公开操作保留授权、事务生命周期、PII、观察时间、分页及独立重试职责。

## User Stories

1. 作为 Instructor，我希望 Overview 进度只包含已授权 Course，以便分析自己的课程而不访问其他课程的数据。
2. 作为 Admin，我希望保留现有全局及按 Instructor 筛选的权限，以便继续使用已有分析范围。
3. 作为 Student，我希望 analytics 继续拒绝未经授权的访问，以便保护课程分析和名单信息。
4. 作为授权查看者，我希望只有查询时仍存在且 Enrollment 日期符合范围的人群被纳入，以便正确理解所选人群的当前进度。
5. 作为授权查看者，我希望日期起点包含、终点排除，以便相邻区间的筛选行为保持明确。
6. 作为授权查看者，我希望重复 Enrollment 在日期筛选后只计一次关系，以便不扩大进度分母。
7. 作为授权查看者，我希望一个人参加多门 Course 时保留每门课程的 Enrollment 关系，以便正确汇总可完成单位。
8. 作为授权查看者，我希望仅 Completed lesson 被计入完成数，以便 InProgress 不被误计为完成。
9. 作为授权查看者，我希望重复的完成记录只计一次 lesson，以便不扩大进度分子。
10. 作为授权查看者，我希望 lesson 按实际 Course 归属计算，以便跨课程完成记录不会污染结果。
11. 作为授权查看者，我希望完成记录反映当前状态，以便不将所选 Enrollment 人群误解为期间完成事件统计。
12. 作为授权查看者，我希望 Overview 按完成和可完成 student-lesson 单位汇总，以便不同 Course 大小获得正确权重。
13. 作为授权查看者，我希望进度聚合保留完整精度，以便结果不因提前取整而失真。
14. 作为授权查看者，我希望 Course summary 显示整门课程的正确聚合，以便比较课程学习情况。
15. 作为授权查看者，我希望 Student 行显示该人的个人进度，以便理解当前名单页的学习情况。
16. 作为授权查看者，我希望 Course summary 翻页不改变 Overview KPI，以便区分展示页与分析 scope。
17. 作为授权查看者，我希望 Student 名单翻页不改变整 Course 进度，以便避免用当前页平均值替代课程聚合。
18. 作为授权查看者，我希望有 Enrollment 和 lesson 但无完成时显示真实零，以便区别零进度与缺少可计算数据。
19. 作为授权查看者，我希望正常读取时无 Enrollment 显示 empty、无 lesson 显示 unavailable，以便准确理解没有数值的原因。
20. 作为授权查看者，我希望故障时保留各入口原有状态，以便重构不改变已有可观察行为。
21. 作为授权查看者，我希望 progress 故障后成功的购买额和 Enrollment Count 仍可使用，以便局部故障不遮蔽其他指标。
22. 作为授权查看者，我希望 progress 与 quiz 读取彼此隔离且身份信息保持原有处理，以便单项故障不破坏名单展示。
23. 作为授权查看者，我希望独立重试只重新读取所请求指标并重新授权，以便获得范围安全的局部恢复结果。
24. 作为授权查看者，我希望保留初始共享观察时间及重试的新观察时间，以便知道各结果何时读取。
25. 作为授权查看者，我希望名单重试继续返回当前符合条件的页且不携带 PII，以便成员变化和隐私规则保持一致。
26. 作为维护者，我希望共用事实读取支持三种聚合，以便一次规则修正具有 locality。
27. 作为维护者，我希望通过公开操作测试共享事实、故障及分页，以便内部重构不使行为测试失效。
28. 作为维护者，我希望进度查询按目标范围批量执行，以便不引入逐学生查询或不必要的全量物化。

## Implementation Decisions

- **范围已确认：** Q1–Q8 均已确认。保持公开参数、返回结构、四种指标状态及原因码，不改变权重、日期、人群、授权、分页、PII、观察时间或独立重试语义。
- **Module 与 seam：** 共用 progress module 先留在现有 analytics module 内。三种读取口径有明确内部入口，输出相应进度指标；计数、去重、聚合及状态规则位于 implementation 内。调用者不重新实现这些规则，不引入可任意组合的权重、去重或提前返回开关。
- **Overview 输入：** 现有事务、全部已授权 Course ID 和 Enrollment 日期范围；内部读取有效 Enrollment，并输出全 scope 的加权进度。
- **Course 输入：** 现有事务、当前 Course 页 ID 和该页已成功读取的有效 Enrollment；复用该事实，不重复查询，输出逐 Course 进度。
- **Student 输入：** 现有事务、已授权 Course ID 和已按 Enrollment 日期筛选并分页的 Student ID；仅计算该页个人进度。不接收姓名或邮箱，不重新选择名单。
- **有效人群：** 使用当前仍存在、enrolledAt 在包含 start、排除 end 的区间内的 Enrollment，再按 user 与 Course 关系去重。不重建已移除 Enrollment，不新增按平台 Student 角色筛选的条件。术语 Student 不构成改变现有 Enrollment 人群的授权。
- **共用事实：** lesson 的 Course 归属按 lesson 所属教学模块确定；Completed 按 user、Course、lesson 去重，不按 completedAt 限制日期。
- **聚合：** Overview 为总完成 / 总可完成 student-lesson 单位；Course 为该课程所有有效关系的聚合；Student 为个人完成 / 该 Course lesson 数。保持完整精度，保留现有展示取整方式。
- **混合 Course：** 无 lesson Course 对 Overview 分母贡献 0，不把 unavailable 当作零百分比加入均值；若其他 Course 有可完成 lesson，Overview 仍计算整体比值。
- **状态差异：** Overview 无有效 Enrollment 时先返回 empty/no_records，总可完成数为 0 时先返回 unavailable/no_lessons。Course summary 在有效 Enrollment 查询成功后仍执行原有 lesson/completion 读取；Student 当前页有学生时仍执行原有读取。不得统一提前返回而改变故障状态优先级。
- **读取与失败隔离：** Overview Enrollment Count 与 progress 保持分别读取及错误处理；Course summary 共用有效 Enrollment，但成功的 Count 不因后续 progress 故障失败；名单身份读取先于个人指标，progress 与 quiz 保持独立。一次批量进度查询失败仍按原入口整批失败，不增加逐 Course 或逐 Student 的挽救重试。
- **调用者职责：** 保留授权、空授权 scope 处理、事务生命周期、身份、排序、分页、Enrollment 日期展示、asOf、公开响应组装和独立重试选择。重试重新授权；初始结果共享 asOf，独立重试保留混合观察时间语义。
- **依赖：** 使用现有事务和数据库实例；不建立新连接或新事务，不增加请求级缓存、数据库端口或 repository 抽象。按授权 scope、当前 Course 页或当前 Student 页批量读取，不引入逐学生查询，也不为共用实现加载全部学生完成记录。
- **可调整细节：** 私有函数名称、数量、内部 Map 结构和查询表达式由实现决定。可以组合私有读取与计算函数，不要求类、工厂或额外导出的类型。没有 Schema、迁移或写入流程变更。
- **项目规范：** 实现遵循现有 TypeScript、后端、数据库及测试规范；保留认证与数据安全措施，不新增 hash、冻结 contract、baseline 或 gate。

## Testing Decisions

测试 seam 已由用户在 Q7、Q8 确认，无需重新采访。主 seam 是 analytics 的公开操作：getAnalyticsOverview、getCourseAnalytics、getAnalyticsMetric 和 getStudentSnapshotMetric；使用真实测试 SQLite。断言可观察结果，不固定 SQL、内部函数数量、调用顺序或计算 helper。

沿用 analyticsService 的现有业务测试及 purchaseService、enrollmentService、progressService 的数据库测试方式：在导入被测服务前使用规定的数据库 getter mock，在 beforeEach 中调用 createTestDb 和 seedBaseData，应用真实迁移和外键约束。延续表重命名的故障注入，并在故障恢复后验证结果恢复。

保留既有加权、日期、去重、授权、PII、分页、兄弟指标隔离及独立重试测试。先补现状行为用例，再执行重构；新增用例不依赖未来私有函数。只整理真正重复的测试准备代码，不删除有独立业务职责的用例。已有路由和展示测试保留，本次不增加浏览器测试或内部计算测试。

新增一个聚焦的共享 fixture，覆盖不同 lesson 数的两门 Course、多个学生及重复 Enrollment/completion，通过公开初始与重试操作分别断言正确结果。最小口径示例：2 与 4 个 lesson 的两门 Course，各一名有效学生、各完成 1 个，Overview 为 2/6 × 100，Course 与对应 Student 为 50%、25%。实际共享 fixture 包含多个学生；一致性是事实一致，不是要求各百分比相等。故障和分页 fixture 单独组织。

验收矩阵：

| 场景                                                 | 可观察预期                                                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 不同 Course 大小、多人、重复记录                     | 正确加权和去重；Student、Course、Overview 各自口径正确，保留精度                                        |
| 日期边界、范围外或已移除 Enrollment 的残留完成记录   | start 包含、end 排除；先筛 Enrollment 再去重；排除不合格人群，不按 completedAt 筛选                     |
| 有 Enrollment、有 lesson、无完成                     | value 0                                                                                                 |
| 无有效 Enrollment且完成表故障                        | Overview 为 empty/no_records；有 Course summary 行时其 progress 为 error/read_failed；Student rows 为空 |
| 有 Enrollment、无 lesson且完成表故障                 | Overview 为 unavailable/no_lessons；Course summary 与 Student 行 progress 为 error/read_failed          |
| 完成表恢复                                           | 无 Enrollment 时对应聚合为 empty；有 Enrollment、无 lesson 为 unavailable；有 lesson、无完成为 value 0  |
| 有 lesson 与无 lesson Course 混合                    | 无 lesson Course 不稀释 Overview 分母；逐 Course 正常读取时保留独立状态                                 |
| 有 lesson且完成表故障                                | 对应入口按既有批量范围返回 progress error；成功的购买额、Count、身份和 quiz 保留                        |
| 超过 20 名学生且页间进度不同                         | 名单只返回当前页个人结果，整 Course 指标不使用该页平均值                                                |
| 超过 20 门 Course且页间数据不同                      | summary 只返回当前课程页，Overview KPI 不随 summary 翻页改变                                            |
| 独立重试与成员变化                                   | 重新授权、只读所请求指标、新观察时间、返回当前名单页、重试无 PII；保留 quiz 与 progress 隔离            |
| 角色拒绝、所有权变更、删除、Admin 筛选和空授权 scope | 保持现有 forbidden、not_found 与 no_authorized_courses 语义及 PII 安全规则                              |

完成实现时，应运行修改服务的测试、受影响的既有 analytics 路由及展示测试，以及项目类型检查。测试命令与结果在交付中报告；本 PRD 不声称这些检查已经运行。

## Out of Scope

- 改变产品语义、公开返回结构、UI、排序、页大小、授权或独立重试协议。
- 统一已确认保留的故障状态差异，或新增逐行故障挽救与重试。
- 改写既有 progress 写入或旧计算服务，新增时长权重、历史趋势或按完成事件日期统计。
- 新增按角色筛选 Enrollment、重建历史 Enrollment、改变删除流程或补唯一约束。
- Schema、迁移、预聚合表、外部依赖、请求级缓存、新数据库连接或 repository/port 抽象。
- 抽出独立文件、扩大为全平台进度架构重构、增加浏览器测试或冻结内部函数与 SQL。
- 新增 hash、冻结 contract、baseline 或 gate；删除既有安全措施。
- 在本次规格发布过程中实现代码、拆分子任务、提交 Git、创建 PR 或部署。

## Further Notes

- 决策来源是已由用户确认 Q1–Q8 的 Grill 验收记录和架构评审，原始资料已移入本机归档目录，不随 Git 分发。本文与 [Issue #16](https://github.com/Endercloud001/matt-practice-project/issues/16) 保留完整执行规格，不要求代理读取本机归档，不重新开放已确认问题。
- 领域术语依据根 CONTEXT.md；已有 dashboard 规格见 [Instructor analytics dashboard spec](instructor-analytics-dashboard-spec.md)。本次没有发现相关 ADR，不假定不存在的 ADR 已批准。
- 当前实现入口为 analyticsService 中的 readStudentProgress、readCourseSummaries、readStudentSnapshots；业务测试为 analyticsService.test，数据库测试准备为 createTestDb 与 seedBaseData。
- 无 lesson 与完成表故障的交叉差异来自代码推导，尚未在本次运行复现；实现前的行为测试应明确验证。正常数据下的口径漂移是风险描述，不是已确认缺陷。
- Student 是平台角色术语，但当前 analytics 人群由 Enrollment 确定，没有新增角色过滤；这是保留现状的明确约束。
- 发布目标为 GitHub origin 仓库 Endercloud001/matt-practice-project；Issue 使用 ready-for-agent 标签，正文包含完整规格，不依赖尚未推送的本地文件才能执行。
- 已发布规格 Issue：[#16：深化 Student progress 读取 module](https://github.com/Endercloud001/matt-practice-project/issues/16)。
- 规格发布阶段只产出规格与 Issue；业务实现与新增测试在后续提交中完成，当前状态见本文顶部。状态核查日期：2026-10-01。
