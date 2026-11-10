# Lead layer — ghi chú phiên làm việc

## Trạng thái hiện tại (2026-11-10)

`/goal` chạy **song song theo sóng** mặc định ở room từ 3 thành viên; room tắt bằng `goalWaves: false` (công tắc trong panel room), `OMB_LEAD_DEPT_CAP=0` tắt mọi nơi, `=1` bật cả room nhỏ. Tắt thì envelope `tasks` bị bỏ qua:

1. **Coordinator ra kế hoạch** thay vì giao từng người: envelope `continue` mang `tasks`
   (`{id, assignee, role?, instruction, reads?, writes?, locks?, dependsOn?}`). Trước khi bung sóng,
   lead phải **định danh role cho từng member** trong phần hiện với người ("Scout — Researcher"…),
   role mỗi task khớp profile bot (roster trong prompt giờ kèm `Role:` của bot). Giới hạn parse:
   ≤ 8 task, id/assignee/role ≤ 100 ký tự, instruction ≤ 2000, mảng ≤ 8 phần tử ≤ 120 ký tự,
   `dependsOn` chỉ trỏ id trong kế hoạch; vi phạm → decision null → blocked.
2. **Xếp sóng** (`server/lead-schedule.ts`): `leadWaves` topo theo `dependsOn` (cap `LEAD_MAX_WAVE_SIZE=5`,
   workers = min(5, số bot khác nhau)); trong sóng `leadBatchesForWave` tách batch không xung đột —
   đụng `reads`/`writes`/`locks` hoặc **cùng một bot** → tách batch chạy tuần tự (lock ảo `bot:<id>`).
3. **Thực thi qua runtime tree** (`runGoalWaveOnTree`, `server/index.ts`): mỗi task trong batch là một
   work child của `coordinator.enqueue`, chạy trong lane thread riêng (mở bằng `roomJobs.openLane`,
   title `<room> · <việc>`, ở sidebar của bot). Wave root được mint với `reply: "poll"` → khi children
   settle, root **settle tại chỗ** (`runtime.ts:304-306`) — không bao giờ có coordinator turn chạy ngoài
   vòng lặp. Kết quả về room do `host.report` post (activity row `roomRequest: {phase: "result"}` trong
   thread goal — dạng result card như room jobs). Runtime tự lo dispatch scheduling, queue khi bot bận,
   budget (64 req/96 exec/depth 4, renew khi children settle) và rerun-once sau restart.
4. **Vòng lặp goal giữ nguyên vai**: card `goal.run`, ngân sách 13 turn, đánh giá outcome
   (hard fail → blocked/failed; busy/parked → xin lead giao lại; lặp assignment 3 lần → blocked).
   Turn count: mỗi child đã chạy +1 turn (tăng ở `runGoalRun`, vì runtime không claim qua `onClaimed`).
5. Fallback: không có `dispatchWave` (solo, unit test) → path lane cũ `runLaneGoalStep` / tuần tự
   trong thread goal; DM/solo không mở lane.

## Kiến trúc — vì sao thiết kế thế

- **Bất biến 1-thread = 1-provider-turn** (`activeInternalGenerationByThread`, `server/index.ts`):
  2 worker cùng thread room là bất khả thi ("cannot mint an integration capability for an inactive turn").
  Song song thật ⇒ mỗi task một thread riêng — và runtime tree đã có sẵn toàn bộ cơ chế đó
  (dispatch, report, resume, restart recovery), nên spike tái dùng thay vì làm tay.
- **`reply: "poll"` trên `BeginTurnRequest`** (thêm mới, cộng thêm — `server/coordinator.ts`,
  `runtime-coordinator.ts`): chốt chống resume turn lạc; caller khác không bị ảnh hưởng.
- **Contract `dispatchWave`** (`server/group-goal-run.ts`): thiếu `outcome` + `ran` + có reply →
  mặc định `settled` (`dispatchWaveBatch` chuẩn hóa); thiếu kết quả cho một task → `dispatch_failed`
  → run fail. `runGoalRun` vẫn sở hữu turn counting và đánh giá outcome.

## Giới hạn đã biết

- Vẫn phụ thuộc LLM khai đúng `reads`/`writes` — `lead-schedule` là lưới chặn, không thần thánh.
- Wave worker chạy trong lane thread: chỉ thấy dòng giao việc + prompt hệ thống, **không mang
  lịch sử room**; worker↔worker không chat trực tiếp trong cùng sóng (giao tiếp qua artifact,
  `dependsOn`, và qua lead).
- Card `goal.run` không đếm turn theo thời gian thực cho children (tăng sau khi cả batch xong).

## Verify (đã chạy 2026-11-10)

- Unit 46/46 (`lead-cap`, `lead-schedule`, `group-goal-run`); typecheck `tsconfig.server.json` sạch.
- E2E: `group-goal-run.e2e.test.ts` 13/13 (gồm case "runs a task plan as parallel worker turns on one
  coordinator turn" — worker B xong trước khi gate A mở ⇒ chứng minh dispatch đồng thời) +
  `group-goal-wait-cap.e2e.test.ts` 4/4.
- Env: repo cần **Node ≥ 24** (engines). Máy đã nâng Node hệ thống lên 24.22.2 (MSI chính thức) +
  pnpm qua npm global. Hai bug môi trường có sẵn trong e2e spawn đã sửa (thiếu
  `--experimental-strip-types`, PATH không dẫn node của runner) cho cả 2 suite goal.

## Lịch sử

- Trước đó: lead-dept experiment (`d12be2e4c` đã gỡ, chỉ giữ `lead-schedule`); phương án B lane tay
  (2026-11-09) → thay bằng runtime tree sau spike so sánh. Quyết định hướng: giữ xương goal run,
  làm giàu lớp role; tái cấu trúc toàn bộ lên runtime tree chỉ cân nhắc khi muốn "đội nhóm thường trực".
