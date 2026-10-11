---
name: safe-refactor
description: Extracts logic into small, pure, exported functions without changing behaviour. Use when refactoring changed code for testability or reuse.
---

# Safe refactor

A refactor changes structure, never behaviour. For the same inputs, the code keeps the same outputs, errors, side effects and order of side effects.

## Recipe, per candidate

1. **Name the function** after what it computes, such as `countCompleted(todos)` or `clearedNotice(count)`, not after where it came from.
2. **Choose its home.** If the logic belongs to one module, put the function in a new module next to it, in the same folder. If it is shared within a feature, put it in that feature's `utils` module, when that module is one of the changed files. Export it.
3. **Make it pure.** Pass in what the original code read from IO, such as time, environment or request data. Return the result instead of writing it somewhere.
4. **Move the code unchanged.** Same conditions, same order, same messages, same types. Behaviour fixes are out of scope: record a suspected bug in `skipped`.
5. **Call it from the original place.** The original code now delegates to the new function. Its exported names, signatures and return types stay exactly as they were.
6. **Keep it small:** at most about 40 moved lines per candidate, and no new dependencies.

## Proof

- **Existing tests:** the tests for the changed files pass **without edits**. If one fails, undo that extraction.
- **New tests:** a new test file for the new module tests the extracted function directly, per `unit-test-quality`, including its edge cases.
- **Typecheck:** the area typechecks.

Done when every extraction passes all three proofs, and every undone extraction is listed in `skipped` with the reason.
