import { describe, expect, it } from "vitest";
import { projectDraft, projectDraftProblem, projectProfileOf } from "./RoomProjectSettings";
import { PROJECT_TEMPLATES } from "../../../shared/project-template";

describe("project profile editor", () => {
  it.each(PROJECT_TEMPLATES)("retains and clears the $id template without replacing project fields", ({ id }) => {
    const profile = { template: id, instructions: "Keep my conventions", moduleMap: "custom/", setup: [{ id: "deps", command: "make deps" }] };
    const draft = projectDraft(profile);
    expect(projectDraftProblem(draft)).toBeUndefined();
    expect(projectProfileOf(draft)).toEqual(profile);
    const { template: _, ...withoutTemplate } = profile;
    expect(projectProfileOf({ ...draft, template: undefined })).toEqual(withoutTemplate);
  });
  it("round-trips a saved profile and sends only filled fields", () => {
    const profile = { instructions: "Use pnpm", protectedPaths: ["migrations", "src/legacy"], setup: [{ id: "install", command: "pnpm install", timeoutSec: 300, expectExit: 0 }] };
    expect(projectProfileOf(projectDraft(profile))).toEqual(profile);
    expect(projectProfileOf(projectDraft(null))).toEqual({});
    expect(projectProfileOf({ instructions: "  ", moduleMap: " server/ — API ", protectedPaths: "\n migrations/ \n\n", setup: [{ id: " a ", command: " make " }] }))
      .toEqual({ moduleMap: "server/ — API", protectedPaths: ["migrations/"], setup: [{ id: "a", command: "make" }] });
  });

  it("catches what the server refuses before sending", () => {
    const draft = projectDraft(null);
    expect(projectDraftProblem(draft)).toBeUndefined();
    expect(projectDraftProblem({ ...draft, instructions: "x".repeat(4001) })).toBeTruthy();
    expect(projectDraftProblem({ ...draft, protectedPaths: Array.from({ length: 17 }, (_, n) => `p${n}`).join("\n") })).toBeTruthy();
    for (const path of ["/etc", "C:\\repo", "../outside", "src/../../x"]) expect(projectDraftProblem({ ...draft, protectedPaths: path })).toBeTruthy();
    expect(projectDraftProblem({ ...draft, setup: [{ id: "", command: "make" }] })).toBeTruthy();
  });
});
