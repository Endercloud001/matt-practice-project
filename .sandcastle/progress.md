# Ralph 任务进度

Issue：https://github.com/Endercloud001/matt-practice-project/issues/18
需求快照：.sandcastle/tasks/issue-18.json

## 范围与约束

修复 DEV UI 中选择其他用户并成功切换身份后，Switch user 下拉列表未自动收起的问题。
遵守 AGENTS.md 和相关项目 skills，保留既有认证与 DEV 环境边界。
不推送、不发布、不关闭或评论 GitHub Issue。

## 待办

- [ ] 复现问题，定位菜单状态与身份切换的关系，完成修复及适用的回归验证。

## 验证要求

- 成功切换其他用户后，下拉列表自动收起，身份切换仍正常。
- 执行 pnpm run typecheck 和 pnpm test；其他验证按修改范围选择。

## 本轮交接

尚未开始实现。完成后记录修改、实际验证结果和遗留事项。
