---
name: project-typescript-standards
description: Use when implementing, refactoring, or reviewing TypeScript in this project, or discussing its Coding Standards for function parameters, import aliases, and type safety.
---

# 通用 TypeScript Coding Standards

在本项目对应范围的实现、重构和代码 review 中应用以下规范。Review 时逐条检查相关改动；实现时按规范编写代码。跨范围任务按根目录 AGENTS.md 的引用补充读取其他规范。

## Function Parameters

When a function has more than one parameter of the same type, such as multiple `string` parameters, use an object parameter instead of positional parameters.

```ts
// BAD
const addUserToPost = (userId: string, postId: string) => {};

// GOOD
const addUserToPost = (opts: { userId: string; postId: string }) => {};
```

## Import Aliases

Use the `~/*` import alias for anything inside `/app`.

Do not use relative imports such as `../../lib/utils`; use imports such as `~/lib/utils` instead.

## TypeScript Type Safety

Do not use `any`.

If you need a type and are not sure what it should be, check the Drizzle schema or use `typeof` inference.
