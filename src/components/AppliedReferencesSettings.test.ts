import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { REFERENCES } from "../../shared/references";
import { AppliedReferencesSettings } from "./AppliedReferencesSettings";

const root = resolve(__dirname, "../..");

describe("applied references", () => {
  it("lists each source once, with its status", () => {
    const html = renderToStaticMarkup(createElement(AppliedReferencesSettings));
    for (const reference of REFERENCES) {
      expect(html).toContain(`data-reference="${reference.id}"`);
      expect(html).toContain(`data-status="${reference.status}"`);
      expect(html).toContain(reference.url);
    }
    expect(new Set(REFERENCES.map((reference) => reference.id)).size).toBe(REFERENCES.length);
    expect(new Set(REFERENCES.map((reference) => reference.url.toLowerCase())).size).toBe(REFERENCES.length);
  });

  it("points every applied technique at files that exist and says what was taken", () => {
    for (const reference of REFERENCES.filter((entry) => entry.status === "applied")) {
      expect(reference.took.length, reference.id).toBeGreaterThan(0);
      expect(reference.appliedIn.length, reference.id).toBeGreaterThan(0);
      for (const file of reference.appliedIn) expect(existsSync(resolve(root, file)), `${reference.id}: ${file}`).toBe(true);
    }
  });
});
