import assert from "node:assert/strict";
import test from "node:test";

import { buildSystemPrompt, buildTask, skillSummary } from "./agent-prompt.ts";

const agent = "---\r\nname: test-engineer\r\nskills: unit-test-quality, test-verification\r\n---\r\n\r\nYou are the test engineer.\r\n";

test("builds the system prompt from the agent body, the tool mapping and its own skills only", () => {
  const prompt = buildSystemPrompt(agent, [
    { name: "unit-test-quality", description: "What a good test is." },
    { name: "safe-refactor", description: "Not for this agent." },
  ]);

  assert.match(prompt, /^You are the test engineer\./);
  assert.doesNotMatch(prompt, /^---/);
  assert.match(prompt, /`load_skill`/);
  assert.match(prompt, /- `unit-test-quality`: What a good test is\./);
  assert.doesNotMatch(prompt, /safe-refactor/);
});

test("reads a skill's name and description from its frontmatter", () => {
  assert.deepEqual(skillSummary("---\nname: test-verification\ndescription: Prove tests green.\n---\nBody"), {
    name: "test-verification",
    description: "Prove tests green.",
  });
  assert.equal(skillSummary("No frontmatter"), null);
});

test("puts the plan and a capped diff in the task", () => {
  const task = buildTask({ plan: { areas: ["backend"] }, diff: "x".repeat(70_000) });

  assert.match(task, /"areas": \[\s*"backend"\s*\]/);
  assert.match(task, /\[diff truncated/);
  assert.ok(task.length < 61_000);
});
