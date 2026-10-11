---
name: frontend-unit-tests
description: Conventions for Taskly frontend unit tests (React 19, TanStack Query, Vitest, Testing Library). Use when writing or updating *.test.ts(x) under frontend/src.
---

# Frontend unit tests

Read the existing co-located test closest to your target before writing; match its style.

## Layout

- Co-located: `Foo.tsx` → `Foo.test.tsx`, `useFoo.ts` → `useFoo.test.ts` (use `.tsx` when the test renders JSX, e.g. a provider wrapper).
- `import { expect, it, vi } from 'vitest'`; `render`, `screen`, `renderHook`, `waitFor` from `@testing-library/react`; `userEvent` from `@testing-library/user-event`. jest-dom matchers are global.
- Fixture: `src/test/todoFixture.ts` (`todoFixture`); spread it to vary fields.

## Seams

| Module kind | Seam | Replace |
| --- | --- | --- |
| Component | what the user sees and does: roles, accessible names, text | the design system: `vi.mock('<relative>/design-system', () => import('<relative>/design-system/mocks'))`; child components and data hooks with `vi.mock` + `vi.mocked(hook).mockReturnValue(...)` |
| Query/mutation hook | `renderHook` result and the query cache | `todosApi` via `vi.mock('../api/todos', () => ({ todosApi: { list: vi.fn(), ... } }))`; per test, `const client = createTestQueryClient()` and `renderHook(..., { wrapper: queryWrapper(client) })` from `src/test/queryClient.tsx` |
| `lib/http.ts`, `api/*` | returned value / thrown message | `globalThis.fetch = vi.fn()` (restore after), or mock `request` |
| Pure util | return value | nothing |

For a mutation hook, seed the cache with `client.setQueryData(todoKeys.list, [...])`, run `result.current.mutateAsync(...)` inside `act`, then assert `client.getQueryData(todoKeys.list)`.

## What to assert

The general rules are in `unit-test-quality`. Frontend specifics:

- Behaviour a user or caller observes: rendered text, enabled/disabled controls, callbacks fired with the right arguments, cache contents.
- Query by role and accessible name first (`getByRole('button', { name: 'Delete task' })`), text second; `data-testid` only for the mocked `Alert`.
- UI copy uses typographic characters (`…`, `“ ”`); copy strings from the source file.
- Time-dependent code (`useNotice`, `isOverdue`) runs under `vi.useFakeTimers()` / `vi.setSystemTime(...)`, restored with `vi.useRealTimers()`.
