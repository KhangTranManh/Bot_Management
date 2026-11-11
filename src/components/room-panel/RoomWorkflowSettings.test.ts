import { describe, expect, it } from "vitest";
import { verifyDraftProblem } from "./RoomWorkflowSettings";

describe("verify editor", () => {
  it("accepts no checks, normal checks and nonzero expected exit codes", () => {
    expect(verifyDraftProblem([])).toBeUndefined();
    expect(verifyDraftProblem([{ id: "tests", command: "npm test", timeoutSec: 120, expectExit: 1 }])).toBeUndefined();
  });
  it("catches incomplete, duplicate and invalid numerical fields before sending", () => {
    expect(verifyDraftProblem([{ id: "tests", command: " " }])).toBeTruthy();
    expect(verifyDraftProblem([{ id: "same", command: "a" }, { id: "same", command: "b" }])).toBeTruthy();
    for (const timeoutSec of [NaN, 0, -1, 3601]) expect(verifyDraftProblem([{ id: "t", command: "npm test", timeoutSec }])).toBeTruthy();
    expect(verifyDraftProblem([{ id: "t", command: "npm test", expectExit: .1 }])).toBeTruthy();
    expect(verifyDraftProblem(Array.from({ length: 9 }, (_, id) => ({ id: String(id), command: "test" })))).toBeTruthy();
  });
});
