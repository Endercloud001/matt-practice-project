---
name: project-database-standards
description: Use when implementing, refactoring, or reviewing Drizzle schemas, migrations, SQLite persistence, deletion, connections, or price storage in this project, or discussing database Coding Standards.
---

# 数据库 Coding Standards

在本项目对应范围的实现、重构和代码 review 中应用以下规范。Review 时逐条检查相关改动；实现时按规范编写代码。跨范围任务按根目录 AGENTS.md 的引用补充读取其他规范。

## Database IDs

Database IDs must always use:

```ts
integer().primaryKey({ autoIncrement: true });
```

Do not use UUIDs for database IDs.

## Database Timestamps

Timestamps in the database must be stored as ISO strings in `text` columns, not as Unix timestamps or integers.

Use the following default function for timestamp defaults:

```ts
$defaultFn(() => new Date().toISOString());
```

## SQLite Booleans

Booleans in SQLite must be stored as integers with Drizzle's `mode: "boolean"`.

Example:

```ts
integer("ppp_enabled", { mode: "boolean" });
```

## Soft Deletes

For soft deletes, use a nullable column:

```ts
text("deleted_at");
```

Do not actually delete rows.

See `lessonComments` in the schema for an example.

## Database Connection

The database is SQLite via `better-sqlite3` and Drizzle.

The database instance is initialized in:

```txt
app/db/index.ts
```

It is configured with WAL mode and foreign keys enabled.

Do not create new `Database` connections in service code unless there is a very strong reason.

## Price Storage

Price values must be stored in cents as integers.
