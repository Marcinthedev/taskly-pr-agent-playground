import test from "node:test";
import assert from "node:assert/strict";

import { extractDecision, finalAgentText } from "./decision.mjs";

const valid = {
  decision: "tests_added",
  summary: "Added router tests.",
  skills_used: ["pr-change-analysis", "backend-unit-tests"],
  files: [{ path: "backend/tests/router.test.ts", action: "updated", covers: "DELETE /completed" }],
  skipped: [],
};

test("extractDecision reads the last fenced json block of the final message", () => {
  const text = [
    "Earlier draft:",
    "```json",
    JSON.stringify({ ...valid, decision: "abstained" }),
    "```",
    "Final report:",
    "```json",
    JSON.stringify(valid, null, 2),
    "```",
  ].join("\n");

  assert.deepEqual(extractDecision(text), valid);
});

test("extractDecision rejects unknown decisions and malformed shapes", () => {
  const wrap = (value) => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;

  assert.equal(extractDecision("no json here"), null);
  assert.equal(extractDecision("```json\n{not json}\n```"), null);
  assert.equal(extractDecision(wrap({ ...valid, decision: "merged_to_main" })), null);
  assert.equal(extractDecision(wrap({ ...valid, files: "everything" })), null);
  assert.equal(extractDecision(wrap({ ...valid, files: [{ path: 3 }] })), null);
});

test("extractDecision fills optional arrays", () => {
  const text = "```json\n" + JSON.stringify({ decision: "no_tests_needed", summary: "Docs only." }) + "\n```";
  assert.deepEqual(extractDecision(text), {
    decision: "no_tests_needed",
    summary: "Docs only.",
    skills_used: [],
    files: [],
    skipped: [],
  });
});

test("finalAgentText returns the result text from a Claude Code execution log", () => {
  const log = [
    { type: "system", subtype: "init" },
    { type: "assistant", message: { content: [{ type: "text", text: "working" }] } },
    { type: "result", subtype: "success", result: "done ```json {} ```" },
  ];
  assert.equal(finalAgentText(log), "done ```json {} ```");
  assert.equal(finalAgentText([]), "");
  assert.equal(finalAgentText(null), "");
});
