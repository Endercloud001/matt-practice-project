---
name: project-testing-standards
description: Use when implementing or reviewing services and their test coverage, writing or changing Vitest tests in this project, or discussing testing Coding Standards.
---

# 测试 Coding Standards

在本项目对应范围的实现、重构和代码 review 中应用以下规范。Review 时逐条检查相关改动；实现时按规范编写代码。跨范围任务按根目录 AGENTS.md 的引用补充读取其他规范。

## Service Tests

Anything marked as a service, including files named like `authTokenService.ts`, must have tests written in an accompanying `.test.ts` file.

## Vitest Database Mocking

Tests use Vitest with globals.

Every test file must mock the database module like this:

```ts
let testDb: ReturnType<typeof createTestDb>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));
```

The mock must come before importing the service under test.

Use `createTestDb()` and `seedBaseData()` from `~/test/setup` in `beforeEach`.
