---
name: backend-unit-tests
description: Conventions for Taskly backend unit tests (Express 5, Prisma, Zod, Vitest, supertest). Use when writing or updating tests under backend/tests.
---

# Backend unit tests

Read one existing test that is closest to your target before writing; match its style.

## Layout

- One file per source module: `backend/src/**/<name>.ts` → `backend/tests/<name>.test.ts`. If that file already tests a different module with the same name, use `backend/tests/<parent-folder>-<name>.test.ts`.
- New test files import source with the `.ts` extension (`import { createTodosRouter } from '../src/features/todos/router.ts'`); when editing an existing file, keep its import style.
- `import { describe, it, expect, vi } from 'vitest'`. Shared rows live in `backend/tests/fixture.ts` (`record` is a Prisma row, `todo` is the API shape).

## Seams

Test at the module's public surface, with the IO edge replaced:

| Module | Seam | Fake |
| --- | --- | --- |
| `features/todos/router.ts` | HTTP via `supertest` on an `express()` app mounting the router | a `TodoStore` object of `vi.fn()`s (see `router.test.ts` `setup()`) |
| `factory.ts`, `api/health.ts` | HTTP via `supertest` on `createApp(database, createLogger('silent'))` | `{ todo: { findFirst: vi.fn() } } as any` |
| `features/todos/repository.ts` | repository methods | `createDatabase('postgresql://test:test@localhost:5432/test')` plus `vi.spyOn(database.todo, 'findMany')` etc.; no PostgreSQL connects |
| `core/database.ts` | exported functions | `{ $queryRaw: vi.fn(), $executeRaw: vi.fn() }` |
| `core/config.ts`, `core/logger.ts` | exported functions | copy `process.env` in `beforeEach`, restore in `afterEach`; spy on `console.*` |

## What to assert

The general rules are in `unit-test-quality`. Backend specifics:
- Status code **and** body for every HTTP case. Also the repository call arguments when the router transforms input.
- Validation: a rejected payload returns 422 and never reaches the repository.
- Failure paths: a rejecting fake produces the documented error status. Express 5 forwards async errors to the app error handler.
- Build fakes inside the test or a `setup()` helper. Call `vi.restoreAllMocks()` in `afterEach` when spying on real objects.
