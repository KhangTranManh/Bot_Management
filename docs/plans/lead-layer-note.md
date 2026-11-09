# Lead layer — ghi chú phiên làm việc

## Mục tiêu ban đầu → kết luận

Đưa 1 mục tiêu → "Lead" chia việc → các bot chạy song song → hoàn thành. Sau khi khảo sát, nhận ra **`/goal` (team goal run) đã có sẵn** và gần đủ nhu cầu, nên chuyển sang dùng `/goal` thay vì xây song song.

## Kết quả ròng (net change so với gốc)

- **Giữ:** `server/lead-schedule.ts` + `server/lead-schedule.test.ts` — module thuần, tự chứa:
  - `leadTasksConflict(a, b)` / `canRunParallel(a, b)` — 2 task có đụng `writes`/`reads`/`locks` không.
  - `leadWaves(tasks, maxWorkers)` — xếp task thành sóng theo `dependsOn` (topo), cap `LEAD_MAX_WAVE_SIZE = 5`.
  - `leadConflictsInWave(wave)` — liệt kê cặp cần tuần tự trong một sóng.
  - **Hiện chưa được import ở đâu** (dead code), chỉ chờ dùng.
- **Đã gỡ:** `lead-dept` package, goal/task schema (`lead-goal`), vendor-check (`lead-roles`), cap (`lead-cap`), `lead-run`, `lead-runner`, CLI `lead plan`/`lead run`, ví dụ `example-goal`.
- **Không đổi:** `/goal` và toàn bộ UI/server gốc.

## `/goal` hiện tại (đã có sẵn — không cần code)

Gõ `/goal` + yêu cầu trong room (hoặc nút "Finish together") → coordinator chia việc, giao từng bot, chạy, lặp (≤13 turn) → card `goal.run` hiện trạng thái.

- Loop: `server/group-goal-run.ts` (`runGoalRun`, envelope `<openmaus-goal>`).
- Card: `server/host/goal-cards.ts` + `src/components/GoalRunCard.tsx`.
- UI trigger: `src/components/Composer.tsx` (`/goal`), `ComposerPlusMenu.tsx`.
- **Tuần tự:** 1 worker mỗi coordinator turn.

## Giới hạn song song hiện tại

- Mỗi bot: ≤ **16** thread song song — `server/bot-thread-limits.ts:6`.
- `coordinate_bots`: **1–4** bot mỗi lệnh — `server/drivers/agents-catalog.ts:230`.
- `LEAD_MAX_WAVE_SIZE = 5` — `server/lead-schedule.ts`.

## Quyết định đang chờ (define sau)

Làm `/goal` song song bằng `lead-schedule`, sau flag `OMB_LEAD_DEPT_CAP`:

- **A (nhẹ):** envelope cho phép ra 1 "sóng" `{member, instruction, writes?}`; có `writes` thì `lead-schedule` kiểm tra đụng nhau (đụng → tuần tự), không khai thì tuần tự.
- **B (đầy đủ):** coordinator ra kế hoạch task cấu trúc `{id, reads, writes, locks, dependsOn, assignee}` → `leadWaves` xếp sóng an toàn → chạy song song từng sóng.
- **Điểm chung:** cả 2 vẫn phụ thuộc LLM khai đúng `reads`/`writes`; `lead-schedule` là lưới chặn, không thần thánh.

## Commits chính

- `d12be2e4c` — cleanup: bỏ lead layer, chỉ giữ `lead-schedule`.
- Trước đó (đã gỡ): `91742d92b` runner, `3c889acdd` `lead plan`, `4da9ae05a` ví dụ, `183f78654` `lead run`.
