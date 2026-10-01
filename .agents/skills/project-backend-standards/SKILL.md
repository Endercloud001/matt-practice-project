---
name: project-backend-standards
description: Use when implementing, refactoring, or reviewing React Router routes, loaders, actions, validation, authentication, or services in this project, or discussing backend Coding Standards.
---

# 后端路由与服务 Coding Standards

在本项目对应范围的实现、重构和代码 review 中应用以下规范。Review 时逐条检查相关改动；实现时按规范编写代码。跨范围任务按根目录 AGENTS.md 的引用补充读取其他规范。

## React Router v7 Routes

The application uses React Router v7 with file-based routing.

Routes must be placed in `app/routes/`.

Each route file may export:

- `loader`
- `action`
- `default` component
- `meta`
- `ErrorBoundary`

Do not put business logic directly in route files. Call into services instead.

## Route Validation Helpers

For form validation in route actions, use:

```ts
parseFormData(formData, zodSchema);
```

Import it from:

```ts
~/lib/aadiilnotv;
```

It returns:

```ts
{
  (success, data, errors);
}
```

Use `parseParams` for route params.

Use `parseJsonBody` for JSON request bodies.

## Multiple Form Submissions in One Action

When a single route action needs to handle multiple different form submissions, such as a page with both a "mark complete" button and a "delete comment" button, use Zod discriminated unions on an `intent` field.

```ts
const schema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("mark-complete") }),
  z.object({
    intent: z.literal("delete-comment"),
    commentId: z.coerce.number(),
  }),
]);
```

## Authentication

Authentication is cookie-based via:

```ts
~/lib/einosss;
```

Use `getCurrentUserId(request)` in loaders and actions.

It returns:

```ts
number | null;
```

Redirect to `/login` when the returned value is `null`.

## Service Result Pattern

When returning tagged or discriminated results from services, excluding validation results, use this pattern:

```ts
{ ok: true, ... } | { ok: false, error: string }
```

See `couponService` for reference.
