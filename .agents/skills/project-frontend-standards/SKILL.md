---
name: project-frontend-standards
description: Use when implementing, refactoring, or reviewing React UI, components, Tailwind classes, or price display in this project, or discussing frontend Coding Standards.
---

# 前端 Coding Standards

在本项目对应范围的实现、重构和代码 review 中应用以下规范。Review 时逐条检查相关改动；实现时按规范编写代码。跨范围任务按根目录 AGENTS.md 的引用补充读取其他规范。

## Tailwind Class Composition

Use `cn()` from `~/lib/utils` when combining Tailwind classes.

`cn()` is based on `clsx` and `tailwind-merge`.

## Component Organization

Shadcn components must live in:

```txt
app/components/ui/
```

Custom components must go directly in:

```txt
app/components/
```

Do not nest component folders deeper than that.

## Price Display

Use `formatPrice()` from `~/lib/utils` to display prices.

It handles the `Free` case for `0` and `null`.
