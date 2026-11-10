import { describe, expect, it } from "vitest";
import { autoGoalOn, looksLikeProgressQuestion, looksLikeWorkRequest } from "./auto-goal.ts";

describe("looksLikeWorkRequest", () => {
  it("takes a request for work in Vietnamese or English", () => {
    for (const text of ["làm trang thanh toán cho web", "hãy sửa lỗi đăng nhập ở server", "giúp mình thêm trang yêu thích", "cài đặt eslint cho dự án", "Build the checkout page", "please add dark mode to the app"]) {
      expect(looksLikeWorkRequest(text), text).toBe(true);
    }
  });
  it("leaves questions, short lines, mentions and chat alone", () => {
    for (const text of ["tình hình sao rồi", "làm xong chưa?", "sửa đi", "@Clover làm trang chủ đi", "cảm ơn nhé, tốt lắm", "what do you think about it", "làmviệc gì đó dài dòng"]) {
      expect(looksLikeWorkRequest(text), text).toBe(false);
    }
  });
});

describe("autoGoalOn", () => {
  it("follows the room's switch, else is on once the room has a Lead", () => {
    expect(autoGoalOn({})).toBe(false);
    expect(autoGoalOn({ roles: { a: "worker" } })).toBe(false);
    expect(autoGoalOn({ roles: { a: "lead" } })).toBe(true);
    expect(autoGoalOn({ autoGoal: false, roles: { a: "lead" } })).toBe(false);
    expect(autoGoalOn({ autoGoal: true })).toBe(true);
  });
});

describe("looksLikeProgressQuestion", () => {
  it("takes a short question about the work's progress", () => {
    for (const text of ["tình hình sao rồi", "tiến độ thế nào?", "xong chưa", "làm tới đâu rồi", "status?", "how is it going"]) expect(looksLikeProgressQuestion(text), text).toBe(true);
  });
  it("leaves mentions, work requests and long messages alone", () => {
    for (const text of ["@Clover tình hình sao rồi", "làm trang chủ cho web", `tình hình ${"rất ".repeat(30)}dài`]) expect(looksLikeProgressQuestion(text), text).toBe(false);
  });
});
