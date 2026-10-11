---
name: testability-review
description: Finds code in changed files that is hard to unit-test or reuse, and ranks extraction candidates. Use before refactoring for testability.
---

# Testability review

Code is easy to test when its logic can be called directly, with plain inputs, and checked by its output. Look in the changed files for logic that can only be reached through something heavy.

## Candidates

| Smell | Example in this stack | Extract into |
| --- | --- | --- |
| Logic inside a route handler | filtering, mapping or deciding a status code inline in `router.get(...)` | a pure function taking the parsed input and returning the result |
| Logic inside a React component or hook | counting, formatting or choosing a message inline in JSX or `onSuccess` | a function in the feature's `utils/` or next to the component |
| Hidden IO in a calculation | `new Date()`, `Math.random()`, `process.env` or `fetch` mixed into a decision | a function that takes the value as a parameter |
| Duplicated logic | the same filter or condition in two changed files | one shared function both call |
| Long branching | nested `if`/`switch` deciding several outcomes | a function per decision, or a lookup table |

## Ranking

Choose the candidates with the most **test value per line moved**:
- branching logic before straight-line code
- logic with edge cases (empty, boundary, invalid) before trivial mapping
- code reused in two places before code used once

## When not to extract

- **Trivial code:** a one-line expression, or a constant.
- **Logic that is only IO:** a repository call that just forwards to Prisma.
- **Code already tested** directly through a cheap interface, such as a pure util with tests.
- **Moves that would change an exported signature** or need a new dependency.

Done when each chosen candidate has: its file and the code involved, the smell, the new function's name and signature, and the edge cases its tests will cover.
