import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCodeShape } from "./check-code-shape.ts";

const limits = { maxLine: 40, maxFile: 5, forbid: [{ from: "web", to: "server" }] };
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "omb-shape-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

describe("checkCodeShape", () => {
  it("accepts short readable code", () => {
    expect(checkCodeShape(project({ "web/a.js": "const a = 1;\n", "server/b.js": "export const b = 2;\n" }), limits)).toEqual([]);
  });

  it("names the long line, the long file and the forbidden import", () => {
    const root = project({
      "web/long.js": `const a = "${"x".repeat(60)}";\n`,
      "web/tall.js": "a\nb\nc\nd\ne\nf\n",
      "web/api.js": 'import { db } from "../server/db.js";\n',
      "server/db.js": "export const db = 1;\n",
      "node_modules/x/index.js": "x".repeat(500),
    });
    expect(checkCodeShape(root, limits).sort()).toEqual([
      "web/api.js: imports ../server/db.js, but web may not import from server",
      "web/long.js:1: 73 characters, at most 40",
      "web/tall.js: 7 lines, at most 5",
    ]);
  });

  it("lets the server import its own folder and package imports pass", () => {
    expect(checkCodeShape(project({ "server/a.js": 'import "./b.js";\nimport x from "express";\n', "server/b.js": "1;\n" }), limits)).toEqual([]);
  });
});
