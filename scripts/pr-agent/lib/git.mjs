// Parsers for NUL-delimited git output (-z), so file names can never be
// misread as extra entries.

/** `git diff --name-status -z -M <base>...<head>` */
export function parseNameStatus(output) {
  const tokens = String(output ?? "").split("\0").filter((token) => token !== "");
  const changes = [];
  for (let index = 0; index < tokens.length; ) {
    const status = tokens[index].charAt(0);
    if (status === "R" || status === "C") {
      changes.push({ status, path: tokens[index + 2] });
      index += 3;
    } else {
      changes.push({ status, path: tokens[index + 1] });
      index += 2;
    }
  }
  return changes;
}

/**
 * Files touched by a unified git patch. Status: A/M/D/R as usual, B for binary
 * content and X for mode changes, so the guard can reject them.
 */
export function patchChanges(patch) {
  const sections = String(patch ?? "").split(/^(?=diff --git )/m).filter((section) => section.startsWith("diff --git "));
  return sections.map((section) => {
    const header = /^diff --git a\/(.+?) b\/(.+)$/m.exec(section);
    const file = header ? header[2] : "";
    let status = "M";
    if (/^deleted file mode /m.test(section)) status = "D";
    else if (/^(rename|copy) (from|to) /m.test(section) || (header && header[1] !== header[2])) status = "R";
    else if (/^(GIT binary patch|Binary files )/m.test(section)) status = "B";
    else if (/^(old mode|new mode) /m.test(section) || /^new file mode (?!100644)/m.test(section)) status = "X";
    else if (/^new file mode 100644/m.test(section)) status = "A";
    return { status, path: file };
  });
}

/** `git status --porcelain=v1 -z -uall` */
export function parsePorcelain(output) {
  const entries = String(output ?? "").split("\0").filter((entry) => entry !== "");
  const changes = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    let status = "M";
    if (code.includes("D")) status = "D";
    else if (code.includes("R") || code.includes("C")) {
      status = "R";
      index += 1; // the next entry is the original path
    } else if (code === "??" || code.includes("A")) status = "A";
    changes.push({ status, path: file });
  }
  return changes;
}
