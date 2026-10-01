# Ralph 任务进度

Issue：https://github.com/Endercloud001/matt-practice-project/issues/18
需求快照：.sandcastle/tasks/issue-18.json

## 范围与约束

修复 DEV UI 中选择其他用户并成功切换身份后，Switch user 下拉列表未自动收起的问题。
遵守 AGENTS.md 和相关项目 skills，保留既有认证与 DEV 环境边界。
不推送、不发布、不关闭或评论 GitHub Issue。

## 待办

- [x] 复现问题，定位菜单状态与身份切换的关系，完成修复及适用的回归验证。

## 验证要求

- 成功切换其他用户后，下拉列表自动收起，身份切换仍正常。
- 执行 pnpm run typecheck 和 pnpm test；其他验证按修改范围选择。

## 本轮交接

已完成 Issue 18 的约定修复。

- 修改 `app/components/dev-ui.tsx`：跟踪 `currentUser.id`，当成功切换导致当前用户变化时自动关闭 Switch user 下拉列表；未修改认证 action 或 DEV 环境边界。
- 新增 `app/components/dev-ui.test.tsx`：覆盖菜单展开后当前用户变更时自动收起，并确认新当前用户仍显示。
- 验证通过：`pnpm test app/components/dev-ui.test.tsx`、`pnpm run typecheck`、`pnpm test`。
- 未运行 `pnpm run build`：本轮未改构建配置、依赖或生产构建路径。

下一轮入口：无已知遗留待办；如需继续，应从新的 Issue 或新的用户反馈开始。
