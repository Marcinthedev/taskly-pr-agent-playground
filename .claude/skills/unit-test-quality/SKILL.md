---
name: unit-test-quality
description: The definition of a well-constructed unit test, as a checklist. Use when writing, reviewing or verifying any unit test.
---

# Unit test quality

A well-constructed unit test proves **one behaviour** through the module's **public interface**. It fails when that behaviour breaks, and stays green through any refactor that keeps the behaviour.

Every test you write or edit meets all nine rules. Read each test against the checklist before you call it done.

## The rules

1. **One behaviour, named as a specification.** The name reads as a sentence about observable behaviour, such as `returns 404 when the task does not exist` or `disables the button while a deletion is pending`. A test has one reason to fail. A second behaviour gets a second test, or a row in an `it.each` table.
2. **Public interface only.** Exercise what a caller uses: an HTTP route, an exported function, a hook's result, what a user sees on screen. Private helpers, internal state and call order stay out of assertions, unless they are the contract (for example, "the repository is never called for invalid input").
3. **Fails for the right reason.** Before keeping a test, find the source line that makes it pass. If that line were deleted or inverted, the test must go red. A test that would stay green is tautological. Rewrite it or drop it.
4. **Independent expected values.** Expected values are literals from the spec, the diff, a fixture or a worked example. They are never recomputed the way the code computes them. Matchers are as strict as the behaviour allows: `toEqual` over `toBeTruthy`, exact text over `toContain`, and the status code **and** the body, not just one.
5. **The edges, not just the happy path.** For each changed behaviour, cover the cases that apply:
   - boundaries, such as 120 vs 121 characters, empty vs one item, or the first and last day
   - invalid input
   - error and empty states, such as a server error or no data
   - the "nothing happens" case, such as busy or disabled
6. **Fakes at the boundary only.** Replace IO: network, database, clock, randomness, the environment, and expensive child components on a seam the skills name. Use the real code for everything inside the module under test. If a test needs many mocks, the seam is probably wrong.
7. **Isolated and deterministic.** Each test builds its own state, through a `setup()` helper or a fixture spread, and restores anything global: mocks, timers, `process.env`, `fetch`. The suite gives the same result in any order, at any time of day, offline, in milliseconds.
8. **Readable at a glance.** Arrange, act, assert, in that order. No `if`, loops or try/catch in a test body; a table belongs in `it.each`. Setup noise goes into helpers. No large snapshots. No `.skip`, `.only`, `.todo` or `it.fails` left behind.
9. **Typed and formatted like production code.** Test files go through the area's strict typecheck.
   - Use typed fakes, such as `vi.fn<Logger['error']>()` or a fake built with `satisfies`.
   - When a fake can't match a large framework type, cast once, inside the setup helper (`as unknown as Database`), never in an assertion.
   - `@ts-ignore`, `@ts-expect-error` and `as any` never silence a type error.
   - Frontend tests are formatted with `node scripts/pr-agent/cli.mjs format frontend <files>`. Backend tests follow the style of the neighbouring test file.

## Updating an existing test

When the behaviour changed on purpose, update the expected values to the new behaviour. Keep the assertion as strong as it was. A test may lose an assertion only when the behaviour it checked was removed, and the report says so.
