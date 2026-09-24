# Issue #5 Student progress 实现计划

> 按 subagent-driven-development 分工执行；主代理负责集成与验收，子代理使用 GPT 5.6-Sol medium。

**目标：** 总览补齐五卡，新增课程级当前学习快照，保持日期、授权与局部重试。

**架构：** 在现有 analytics service 中按学生—课程去重报名，再池化学生—课时单位。课程身份和指标使用同一事务。两条页面路由共享展示与重试组件，课程 ID 来自路径，URL 保留日期；不新增 schema、连接或框架。

**技术栈：** React Router、React、Drizzle、SQLite、Vitest、现有 Tailwind。

## 1. Service（独立子代理）

- [x] 在 `app/services/analyticsService.test.ts` 从公开接口逐例 RED/GREEN：不同课程课时规模、重复报名、日期边界、残留进度、真实零、空报名、无课时、权限变化和局部失败。
- [x] `app/services/analyticsService.ts` 增加 `studentProgress`（0–100 全精度百分比）、`no_lessons` 原因及 `getCourseAnalytics({userId, courseId, start?, end?, instructorId?})`，成功结果增加 `course: {id, title}`。
- [x] `pnpm exec vitest run app/services/analyticsService.test.ts` 验证，通过后将限定文件集成到主工作树。

## 2. 进度展示与课程页面（主代理）

- [x] `app/components/analytics-metric-card.test.tsx` 先验证最终取整、真实 0%、无课时、空报名与快照文案，再更新组件。
- [x] `app/routes/instructor.analytics.$courseId.test.ts` 通过 Request 和真实 SQLite 验证登录、角色、路径身份、403/404、日期恢复及无 PII。
- [x] 新增 `app/routes/instructor.analytics.$courseId.tsx` 并在 `app/routes.ts` 注册；抽取共享页面到 `app/components/analytics-page.tsx`，共享 loader 编排到 `app/lib/analytics-page.server.ts`。
- [x] 总览使用五张同尺寸卡；课程页面为身份/日期、购买/报名、Course learning outcomes。只有已实现的进度指标，无测验/学生表占位数值。
- [x] 课程 Retry 使用路径课程身份构造 scope；观察代次含路径，日期链接与错误恢复保留课程上下文。
- [x] 针对性测试与 `pnpm typecheck`。

## 3. 验收、审查和交付

- [x] Headless Edge：Instructor/Admin、五卡尺寸、390px 无溢出、键盘日期/课程导航、一个 live region、进度四状态、局部重试时间、授权撤销/恢复与延迟响应。
- [x] `pnpm test` 全套及 `pnpm typecheck`；保存结果到 `docs/issue-5-student-progress-verification.md`。
- [x] code-review 两轴独立审查相对 #4 `1c26181` 的显式暂存 diff，修复并复审。
- [x] 只提交本票文件到 `codex/issue-5-student-progress`，保留原仓库上下文和改动。
