# NOTE: việc còn mở, để định nghĩa sau

Ghi ngày 2026-11-10, cập nhật 2026-11-12. Đường dẫn và số dòng lấy từ lúc khảo sát; xác minh lại trước khi dựa vào.
Trạng thái hiện tại: §10.5–10.6 là định nghĩa UI đã chốt; §11 là tình trạng dùng được; §12 là số đo chạy thật;
§13: hợp đồng vai và chế độ Git/worktree đã nối đầy đủ, Inventory với model thật đã qua; thử conflict thật và đội theo quota còn mở.
§14: bước 1–5 đã code; UI brief/conflict và bước 6 còn mở. Chế độ branch mặc định tắt.
Nhãn: **CỨNG** = server chặn thật; **MỀM** = nằm trong prompt/playbook; **PHÁT HIỆN SAU** = kiểm sau khi xảy ra.

## 1. Lỗi đã biết, cần sửa trước

### 1.1 Bước 1.2 ("consult chạy ở mức ask") không chặn thật — ĐÃ VÁ (B0(i), 2026-11-10, flag `OMB_ROLE_CEILING=1`)
- `levelOf` chỉ ghi mức vào node và envelope (`server/coordinator.ts:149`, `server/host/delegated-level.ts:81-86`).
- Lượt chạy thật gửi `approvalMode: approvalModeForTurn(bot, …)` (`server/index.ts:8468`, định nghĩa `:3083`),
  tức mức riêng của bot; `approvalModeNow` (`:8469`) cũng vậy.
- App còn tự duyệt hộ khi bot ở `full`: `autoApply: fullAccessForSource` (`server/index.ts:9634`, `:3100`).
- Hệ quả: Reviewer và lane trả lời phụ (side reply) vẫn chạy ở mức của chính bot. README đang ghi sai "Reviewers read only".
- Test của commit `fc8ff3d06` chỉ kiểm phần ghi chép, nên không bắt được.
- **Đã vá:** `HandoffView.level` (projection từ `Assignment.level`), `approvalModeUnderCeiling`
  (`server/auto-approve.ts` — chỉ hạ, không nâng; custom một bên giữ mức riêng; đi xuống mức engine chạy được),
  gắn tại 4 chỗ: dispatch trực tiếp + `approvalModeNow` + just-do-it (`server/index.ts:8468-8469`, `:8415`),
  room `roomTurnApprovalMode` (`:3121`, cap sau lift Chief), tự duyệt `request.opened` (`:6516`) và
  `sourceApprovalMode` (`:3093`, qua `coordinator.runningIn`). Flag off = hành vi cũ.
- E2E: `server/role-ceiling.e2e.test.ts` — consult bot `full` chạy `default` khi ON / `bypassPermissions`
  khi OFF; Chief lift vẫn nâng bot Ask khi ON. README "Reviewers read only" đã ghi đúng (B13 xong).

### 1.2 Repo có file không nên commit — ĐÃ XỬ LÝ (`222785ec0`)
- `..dist/` và `test-server-data/` đã gỡ khỏi tracking, có trong `.gitignore`; `pnpm lint` sạch.
- Commit `d` (`18c1530db`) vẫn nằm trong lịch sử đã push; chưa kiểm chứng `test-server-data/` có chứa tin nhắn hay
  phiên đăng nhập thật không. Nếu có: phải viết lại lịch sử, không chỉ gỡ tracking.

### 1.3 Sóng song song có thể ghi đè nhau mà không ai biết — ĐÃ BÁO ĐƯỢC (B0(iii), 2026-11-10)
- Ba điều cùng đúng: sóng song song **bật mặc định** (room 3+), mọi worker **chung một thư mục** (A3),
  `writes` chỉ được **báo sau** (B0(iii)), không chặn.
- Hệ quả: hai Worker cùng sóng khai `writes` khác nhau nhưng thực tế sửa cùng file → bản sau đè bản trước,
  Tester có thể PASS trên bản đã đè. Rủi ro của tính năng đang chạy, không riêng `/research`.
- **Đã làm B0(iii):** snapshot trước/sau mỗi batch wave (`writesSnapshot`, `server/writes-audit.ts`):
  `git status --porcelain -uall` + **hash nội dung** các file đang bẩn (`git hash-object`), nên sửa tiếp một file
  đã bẩn trước wave cũng bị thấy. File đổi ngoài `writes` khai → activity row `ok:false`, không chặn.
  Non-git/không cwd → audit im lặng. Quá 2.000 file bẩn (thư mục phụ thuộc chưa ignore) → chỉ so status.
- Hạn chế còn lại: file bị `.gitignore` không thấy; ghi đồng thời từ lane khác (side reply) bị quy cho wave;
  khớp `writes` theo đuôi đường dẫn (khai `index.ts` khớp mọi `*/index.ts`).
- Audit của Tester hủy PASS (B0(iv)); audit của Worker chỉ báo.

## 2. Việc dở dang

- **Stash "WIP: room now waiting + Open to review" đã mất**: `/now` trả cờ "đang chờ duyệt", Team status có nút
  "Mở để duyệt" mở thẳng lane. Ngày 2026-11-10 `git stash list` trống, không có commit treo nào khớp, mã nguồn
  không có chuỗi này. Muốn có thì làm lại từ đầu.
- **UI còn thiếu** (đã đánh giá, chưa làm):
  1. Bảng kế hoạch trong panel goal (task, người làm, trạng thái, phụ thuộc).
  2. Hiện cổng Tester trên card goal ("Tester: FAIL · vòng sửa 1/3").
  3. Nhãn "Đã chạy như goal · Đổi thành chat" trên tin tự chạy goal.
  4. Team status hiện "hết lượt dùng" và giờ reset.
  5. Huy hiệu vai trong khung chat; kiểm tra màn hình hẹp.
- **Giao diện Neon**: đã có skin, Compact và Văn phòng trên API hiện có; phạm vi frontend và phần còn thiếu ở §10.8.
- **Giới hạn 13 lượt**: hết lượt chỉ "tạm dừng", chạy lại thì đếm từ 0, không có tóm tắt bàn giao.
  Đề xuất: lead viết tóm tắt ở lượt cuối; nút "Tiếp tục" trên card goal; số lượt tối đa theo room.

## 3. Phòng ban nghiên cứu (`/research`) — kết quả Phần A và đánh giá khả thi

Mục tiêu: "xong" = thước đo đạt ngưỡng khai trước trên tập đánh giá khoá. Huấn luyện chạy trên máy GPU khác;
bot chỉ đọc tham số và kết quả. Số liệu phải truy được về file do script sinh ra (provenance).
Project thử đầu tiên: `D:\AGI` (Phase 16). Thiết kế dùng chung cho nhiều project: phần chung trong app, phần riêng
trong file goal của từng project.

### 3.1 Phần A (khảo sát, đã duyệt)
- **A1 quyền:** `delegatedApprovalMode` (`server/auto-approve.ts:41`) chỉ nâng khi phía trên chuỗi giao việc có
  Chief of Staff (`server/host/delegated-level.ts:41-52`); Lead của room không phải Chief; không bao giờ hạ quyền.
  Bảng chạy hàm thật (engine claudeAgent, người gửi là Chief; null = worker giữ mức của mình):

  | gửi \ worker | ask | edits | auto | custom | full |
  |---|---|---|---|---|---|
  | ask | null | null | null | null | null |
  | edits | edits | null | null | null | null |
  | auto | auto | auto | null | null | null |
  | custom | auto | auto | null | null | null |
  | full | full | full | full | null | null |

  opencodeGo: như trên trừ dòng `edits` toàn null. Người gửi không phải Chief: toàn null.
- **A2 PASS:** lấy từ dòng `VERDICT` trong văn bản (`testerVerdict`, `server/team-roles.ts`). Tester chạy `work`,
  không giới hạn vùng ghi (chỉ lời dặn trong prompt — MỀM).
- **A3 writes:** chỉ dùng xếp lịch (`server/lead-schedule.ts`) và bắt buộc khai (`teamPlanProblem`). Không so file
  đổi thật. Mọi worker dùng chung thư mục room (`server/host/room-jobs.ts:62`, `groupTurnCwd` `server/index.ts:10185`).
- **A4 lệnh composer:** viết cứng ở `src/lib/composer-commands.ts`, `src/components/Composer.tsx`,
  `src/state/store.tsx`, `server/routes/channels.ts`. Chưa có cơ chế đăng ký lệnh.
- **A5 cấu hình room:** trường của `WireGroup` (`shared/wire.ts`); `GroupRecord` (`server/store.ts:62`); kiểm ở
  `updateChannel` (`server/index.ts`). Thêm `kind` không cần store mới.
- **A6 plan check:** `parseGroupGoalDecision`, `teamPlanProblem`, kiểm bot hết quota, `leadWaves`.
  `locks` **đã có** (`LeadTaskPlan.locks`).
- **A7 event log:** `<data>/events/<threadId>.ndjson` (`server/harness/bus.ts:245`). `item.started.summary` = lệnh,
  một dòng, che bí mật, tối đa 200 ký tự (`shared/runtime-events.ts:106-109`); `item.completed` có `ok`, `output`
  (`:122`). Không có mã thoát, đường dẫn log, file đổi theo bot. `ok` của Claude = `!is_error`
  (`server/drivers/claude.ts:1574`); chưa kiểm chứng `is_error` bật khi lệnh thoát khác 0.
- **A8 test:** `server/group-goal-run.test.ts`, `server/team-roles.test.ts`, `server/group-goal-run.e2e.test.ts`
  (engine giả, HOME tạm); fixture cách ly theo `docs/verification/README.md`.
- Máy local không có sandbox hệ thống file (log server: `bot box: off (not-cloud)`).

### 3.2 Đánh giá khả thi từng mục Phần B

| Mục | Thêm được | Mức cao nhất | Công | Ghi chú |
|---|---|---|---|---|
| B0(i) trần quyền theo vai | **Xong** (`c65af79db`, flag `OMB_ROLE_CEILING=1`) | CỨNG | Vừa | 4 điểm gắn: dispatch + `approvalModeNow` + just-do-it, room, tự duyệt `request.opened`, `sourceApprovalMode`. |
| B0(ii) PASS cần bằng chứng | **Xong** (`WireGroup.verify`, `server/verify-run.ts`) | CỨNG cho việc chạy lệnh và đọc mã thoát; **chỉ chống T1** | Vừa | Server tự chạy `verify` (shell, cwd room; timeout kill cả cây tiến trình) khi Lead báo completed; PASS cuối = VERDICT ∧ mọi exit đúng `expectExit`; lệch → vòng sửa, quá 3 → `blocked`. Room có `verify` mà không có folder → `blocked` ngay. **Chưa chống T2:** file mà lệnh chạy (test, `package.json` scripts) bot vẫn sửa được — cần danh sách file được bảo vệ (research: khoá hash theo B2). Chỉ đặt được qua API (`PATCH`), chưa có UI. |
| B0(iii) file ngoài `writes` | **Xong** (`writesSnapshot`: porcelain `-uall` + hash nội dung file bẩn) | PHÁT HIỆN SAU | Vừa | Xem §1.3. |
| B0(iv) vùng ghi Tester | **Xong** (audit quanh turn Tester; PASS kèm ghi ngoài vùng báo cáo → void + vòng sửa) | PHÁT HIỆN SAU + void PASS | Nhỏ | Đường batch: vùng báo cáo = `writes` khai trong batch. **Đường đơn: vùng = rỗng** (mọi ghi đều void) — chưa thống nhất. Trần `edits` chưa làm (§6.2 điểm 5). |
| B1 kind code/research | **Xong** (`2efcebda2`, e2e `room-kind`) | CỨNG | Nhỏ | `kind = "research"` bật các luật §8.2 (xem dòng §8.2). |
| B2 file goal (zod) | **Xong** (`server/research-goal.ts`: schema §8.8 + `loadResearchGoal` + sha256; room `goalFile`/`goalFileHash`; duyệt qua PATCH `researchGoalApprove`) | CỨNG (định dạng, khoá hash khi duyệt) | Vừa | Chỉ áp room `kind = "research"`; room khác không đổi. "Xong" = metric qua JSON pointer, gộp seed, so ngưỡng (server tự đọc). |
| B3 Evaluator + tập khoá | **Xong phần quét** (goal file `heldOutPaths`; `heldOutMentions` chỉ đọc `item.started` của chính bot từ lúc turn bắt đầu, khớp cả `/` và `\`; role `evaluator` có audit ghi như Tester) | PHÁT HIỆN SAU | Vừa | Chỉ chống T1; đọc tập khoá bằng đường không qua tool call thì không thấy. T2 cần tách vật lý máy GPU (§8.1, B10). |
| B4 ràng buộc vendor | **Xong** (`model-vendor.ts` + `teamVendorProblem`) | CỨNG (trả kế hoạch) | Nhỏ | Chỉ room `kind = "research"` (§8.2). Reviewer và Evaluator so với mọi Worker đã làm trong cả goal run, cả ở đường batch lẫn đường đơn. Vendor = công ty làm model (họ model trước, tiền tố provider sau); `unknown` bị trả. **Không kiểm:** Tester (§8.2 chỉ nêu Evaluator/Reviewer); backup AI (`bot.fallback`) chỉ dùng khi khởi động nên không được đọc. |
| B5 locks | Đã có | CỨNG trong một goal | — | Khoá xuyên room chỉ cần khi nhiều room dùng chung máy GPU. |
| B6 pilot gate | **Xong** (goal file `pilot.maxTasks`; mọi plan vượt cỡ đều bị trả cho tới khi một plan đầu tiên được nhận) | CỨNG (plan check) | Nhỏ | Mỗi lần gửi lại goal là một pilot mới. |
| B7 ledger + guard ngân sách | **Xong** (ledger JSONL ở `<data>/research/<groupId>.jsonl`, ngoài thư mục room; `run-start`/`verify`/`metric`/`run-end`; ngân sách = thời gian chạy cộng dồn mọi run của cùng hash) | CỨNG (server tự chạy guard) | Vừa | Ngân sách chỉ tính phút (§6.4-4 chưa chốt giờ GPU/token/tiền). Ledger cùng user hệ điều hành với bot nên chỉ chống T1/T2 trong app, không chống T3. |
| B8 duyệt file goal lần đầu | **Xong** (chưa duyệt → `needs-input` kèm sha256) | CỨNG | Nhỏ | Duyệt file goal, không duyệt từng kế hoạch của Lead. |
| B9 hook `/research` | **Xong** (`researchTextFromComposer` + candidate Composer khi room `kind=research`; gửi vào goal mode — gate goal file chấm phần còn lại) | — | Vừa | Hành vi sâu hơn của `/research` đợi đặc tả §6. |
| B10 provenance | Có, phần lớn ngoài app | B (script/validator) | Lớn | Manifest + script chấm điểm Python trên máy GPU; validator so số trong báo cáo với file nguồn. |
| B11 bàn giao GPU | **Xong** (goal file `handoff.expectsFiles`; completed khi thiếu file → `needs-input` nêu tên file, đặt file xong gửi lại goal) | CỨNG (`needs-input`, chờ file) | Vừa | Đường truyền thực tế (§3.3) vẫn là đặt file tay vào thư mục room. |
| B12 rà mục "Xong" | Có | — | Nhỏ | Xem mục 4. |
| B13 sửa README | Có | — | Nhỏ | Xem mục 5. |

### 3.3 Còn trống, sẽ định nghĩa sau
- Hành vi cụ thể của `/research`.
- Đường truyền kết quả từ máy GPU về (copy tay / git / Drive).
- Viết đầy đủ Phần B theo mẫu (mức, loại luật, điểm gắn, test, phương án loại) trước khi làm Phần C.

### 3.4 Thứ tự đề xuất (rẻ và an toàn trước)
1. ~~B0(i) — sửa luôn lỗi mục 1.1~~ **xong** (`c65af79db`).
2. ~~B12–B13~~ **xong** (2026-11-10); kèm **B1** xong (`2efcebda2`).
3. ~~Chốt §8~~ **xong** (4 quyết định ghi ở §8.10).
4. ~~B0(iii), B0(ii) theo §8.3, B0(iv), B4~~ **xong** (2026-11-11, xem §9); phần còn thiếu ghi ở dòng từng mục §3.2.
5. ~~B2, B8, B11, B7, B3, B6, B9~~ **xong** (2026-11-11, §9.1–9.3).
6. Kế tiếp: chạy thử thật trên `D:\AGI` với model thật; đặc tả §6.
7. B10 song song (phần lớn ở phía máy GPU).

B0(i) và B1 code trước khi chốt đặc tả §6 là ngoại lệ có chủ đích. B2–B11 cũng đã code trước khi chốt §6.4; code
đã tự chọn những điểm sau, đặc tả §6 phải xác nhận hoặc sửa: ngân sách chỉ tính phút chạy; vòng thí nghiệm = một
lần đọc metric không đạt; kết quả âm tính kết thúc ở `blocked`; truyền kết quả GPU = đặt file vào thư mục room.

### 3.5 Rủi ro
- Khối lượng lớn: B0 + B1–B11 là nhiều tuần, không phải một phiên.
- B0(i) đụng lõi quyền: làm sai thì chặn nhầm bot thường hoặc lỗ hổng vẫn còn; cần flag và e2e mọi tổ hợp.
- Mức CỨNG chỉ áp cho việc trong app; những gì xảy ra trên máy GPU chỉ tin được qua file và hash.

## 4. Rà các mục đã đánh "Xong" (B12)

| Bước | Commit | Test hành vi thật | Cần bổ sung |
|---|---|---|---|
| 1.1 side reply | `b33a70e48`, `ac0fbac13` | Có: e2e "ordinary chat", "mid-goal" | — |
| 1.2 consult ở ask (B0(i)) | `c65af79db` | Có: e2e `role-ceiling` (consult bot `full` → `default` khi flag ON, `bypassPermissions` khi OFF, Chief lift vẫn nâng khi ON) | — |
| 1.3 sóng mặc định | `f68cf9f7e` | Có: e2e sóng song song không cần cờ; e2e công tắc API | — |
| 2.1–2.5 vai, cổng Tester | `2a843c1cb` | Có: e2e Lead→Worker→Tester→xong. Trả kế hoạch, vòng sửa, chặn `completed` sớm: unit trên vòng goal thật với bước giả lập | e2e cho vòng sửa; Reviewer chỉ-đọc chỉ test việc truyền cờ |
| 2.6 tự chạy goal, `/chat` | `91448816c` | Có: e2e | — |
| 3.1 hết quota | `b4c310c01` | Có: e2e chế độ `usage-limit`, có kiểm ngược | — |
| 4.1 `/now` | `ac0fbac13` | Có: e2e `/now` + DOM | — |
| 4.2 thu gọn tin dài | `07959a2fb` | Có: DOM | — |
| 4.3 trả lời tiến độ | `c83439b99` | Có: e2e | — |
| Grok TOML | `d9e6e346e` | Có: unit, kiểm ngược cả hai sửa | — |

Tất cả chạy trên engine giả; chưa kiểm trên app thật với model thật.

## 5. README cần sửa (B13) — ĐÃ XONG (2026-11-10)
- "Reviewers read only" đã ghi đúng: hard-enforced với `OMB_ROLE_CEILING=1`, không có flag thì dựa model.
- "Ask anyone, stop no one" đã nói rõ nút Stop dừng cả cây việc (có chủ đích).
- Đã thêm mục **Known limitations** (writes chỉ xếp lịch; PASS từ VERDICT tới B0(ii); trần quyền cần flag; API key plain text; local không sandbox; provenance B10; 13 lượt không bàn giao).
- `pnpm lint` đã sạch sau khi gỡ `..dist/` khỏi tracking (commit `222785ec0`).

## 6. Nhiệm vụ "định nghĩa workflow nghiên cứu/huấn luyện" (chỉ tài liệu, không sửa code) — đánh giá

Yêu cầu: viết `docs/plans/research-workflow.md`, `prompts/lead-research.md`, thẻ vai (Worker, Evaluator, Reviewer,
Researcher), các mẫu (file goal, phiếu giao việc, dòng ledger, manifest, báo cáo), bảng ánh xạ chặng -> cơ chế,
bộ kịch bản nghiệm thu mô hình đồ chơi. Hai model Lead khác nhau phải chạy ra cùng hành vi.

### 6.1 Kết luận: làm được, và nên làm trước khi code B0-B11
- Toàn bộ là tài liệu; đúng nguyên tắc "giải bằng quy trình/cấu hình/script trước khi sửa server".
- Viết đặc tả trước giúp chốt những gì B0-B11 phải thi hành, tránh code theo đoán.

### 6.2 Điểm cần đổi hoặc bổ sung so với bản nháp
1. **Viết workflow thành máy trạng thái, không viết văn xuôi.** Muốn hai model Lead cho cùng hành vi thì mỗi chặng
   phải là một trạng thái có tên, với bảng chuyển trạng thái "điều kiện -> trạng thái kế tiếp" đóng (không có lựa chọn
   ngoài bảng). Đầu ra của Lead ở mỗi bước là một khối JSON theo schema cố định (giống envelope `<openmaus-goal>`
   đang có), không phải lời kể. Phương án loại: playbook văn xuôi chi tiết — hai model đọc khác nhau, không so được.
2. **Thêm chặng "Khoá đăng ký trước" (preregistration lock)** giữa "Hợp đồng mục tiêu" và "Pilot": hash file goal sau
   khi bạn duyệt; mọi bước sau đối chiếu hash. Khớp quy tắc 7 của `D:\AGI\README.md` (endpoint đăng ký trước, mở một
   lần). Hiện là MỀM/PHÁT HIỆN SAU (script so hash), CỨNG khi có B2.
3. **Số liệu là tham chiếu, không là giá trị.** Mọi số trong đầu ra của Lead/Evaluator ghi dạng
   `{file, jsonPointer, sha256}`; script điền số vào báo cáo. Validator (B10c) cần có ngay từ bản tài liệu, dù chỉ là
   script chạy tay.
4. **Ghi rõ nhãn luật theo trạng thái hiện tại của code**, không theo đích đến. Hôm nay gần như mọi cổng mới đều
   MỀM hoặc PHÁT HIỆN SAU. Những gì đã CỨNG: plan check theo vai (`server/team-roles.ts`), trần vòng sửa, giao lại
   khi hết quota, `locks` nối tiếp (`server/lead-schedule.ts`), giới hạn lượt. Dừng ở "cần bạn" khi tới bước GPU là
   quyết định của Lead (báo `needs-input`) nên là MỀM.
5. **Chặn ghi cho vai chỉ-đọc làm được ngay bằng cấu hình (mức A), không cần chờ B0(i):** đặt mức quyền riêng của
   các bot Researcher/Reviewer/Evaluator là *Ask* trong cài đặt bot. Lượt chạy thật dùng mức riêng của bot
   (`approvalModeForTurn`, `server/index.ts:3083`), nên mọi ghi/lệnh của các bot này phải chờ bạn duyệt — CỨNG.
   Điều kiện: không có Chief of Staff ở phía trên chuỗi giao việc (Chief nâng quyền, bảng A1), và room không dùng bot
   đó ở vai cần ghi. Chưa kiểm chứng bằng e2e.
6. **Nơi đặt playbook lúc chạy:** repo chưa có thư mục `prompts/`. App nạp hướng dẫn qua hai chỗ: hướng dẫn của room
   (`bulletin`, tối đa 12.000 ký tự, `server/index.ts:3661`) và playbook cài cho bot (`InstalledPlaybook`,
   `shared/wire.ts:229`, cài qua gói team `.md`). Playbook Lead phải vừa 12.000 ký tự nếu đặt vào `bulletin`; thẻ vai
   hợp với `InstalledPlaybook` của từng bot. `prompts/` chỉ là nơi lưu nguồn trong repo.
7. **Kịch bản nghiệm thu so sánh hai Lead bằng dấu vết có cấu trúc**, không bằng văn bản: chuỗi trạng thái đã đi
   qua, các khối JSON quyết định, dòng ledger, có/không dừng ở "cần bạn". Hai Lead đạt nếu chuỗi trạng thái và quyết
   định trùng nhau; câu chữ được phép khác.
8. **Tầng 1 (Search -> giả thuyết -> bạn chọn):** chạy được ngay bằng `/goal` + playbook, bot Researcher ở mức Ask
   (điểm 5). Đầu ra mỗi giả thuyết cần: nguồn (đường dẫn/URL), chi phí ước tính, thước đo dùng để kiểm, cách làm sai.

### 6.3 Rủi ro
- Trước khi có B0/B2/B10, workflow dựa vào việc model tuân thủ playbook: bot vẫn ghi được ở vai Worker/Tester, PASS
  vẫn từ văn bản, số liệu chỉ kiểm được bằng validator chạy tay.
- Đặc tả quá dài thì Lead đọc không hết (giới hạn 12.000 ký tự của `bulletin`).
- Kịch bản nghiệm thu chạy trên engine giả chỉ kiểm phần app; hành vi của model thật chưa kiểm chứng cho tới khi chạy
  với hai model Lead thật.

### 6.4 Cần bạn quyết trước khi viết
1. Thư mục nguồn cho playbook: tạo `prompts/` mới, hay đặt dưới `docs/plans/research/`?
2. Cách nạp lúc chạy: `bulletin` của room, hay đóng gói thành gói team `.md` để cài playbook cho từng bot?
3. Project chạy thử đầu tiên: `D:\AGI` Phase 16?
4. Trần vòng: số vòng sửa nhỏ và số vòng thí nghiệm tối đa; N vòng liên tiếp không cải thiện thì dừng.
5. Vendor cho từng vai (Worker khác vendor với Evaluator/Reviewer).
6. Đường truyền kết quả từ máy GPU về (đang để trống, mục 3.3).

### 6.5 Thứ tự đề xuất
1. Cấu hình ngay (mức A): bot chỉ-đọc ở mức Ask; không đặt Chief phía trên room nghiên cứu.
2. Viết `docs/plans/research-workflow.md` dạng máy trạng thái + schema JSON đầu ra của Lead.
3. Mẫu file goal, phiếu giao việc, ledger, manifest; validator số liệu (script chạy tay).
4. Playbook Lead (vừa 12.000 ký tự) và thẻ vai.
5. Bộ kịch bản nghiệm thu; chạy với hai model Lead thật trên mô hình đồ chơi.
6. Sau đó mới code B0-B11 theo đặc tả đã chốt.

## 7. Test
- Regression trọng tâm 2026-11-10: nhóm đơn vị 7.180 test — 6 lỗi, đã xử lý: 4 Grok (`d9e6e346e`), 1 i18n pt-br
  (`28de29c8c`), 1 `shared/app-frame/helper.test.ts` có từ trước (fail cả trên `0fbeb063e`, phụ thuộc thời gian).
  E2E 51 file liên quan room/goal/điều phối/quota: 328 qua, 4 bỏ qua (skip có sẵn), 0 lỗi.
- Chưa chạy bộ test đầy đủ (~2.476 file, ước 1,5–2 giờ): nên chạy khi máy rảnh.
- Chưa kiểm theo fixture cách ly `docs/verification/README.md` với model thật.

## 8. Bổ sung định nghĩa trước khi code tiếp (2026-11-10)

Các mục dưới là **đề xuất**; chỗ ghi "Cần bạn quyết" phải chốt trước khi code mục B tương ứng.

### 8.1 Mô hình mối đe doạ
Mỗi luật B phải ghi nó chống mối đe doạ nào; nhãn CỨNG chỉ có nghĩa với mối đe doạ đã nêu.

| Mã | Mối đe doạ | Áp cho | Hệ quả thiết kế |
|---|---|---|---|
| T1 | Model **nhầm**: quên vai, ghi sai file, báo PASS khi chưa chạy test | Mọi room | Kiểm tra cấu trúc + phát hiện sau là đủ |
| T2 | Model **lách luật để "xong"**: tự viết tiêu chí dễ, chạy `test \|\| true`, sửa test, đọc tập khoá, chọn số đẹp | Room `research`; Tester/Evaluator ở mọi room | Không được tin bất cứ thứ gì do chính bot bị chấm tạo ra (văn bản, lệnh tự khai, file kết quả nó ghi được) |
| T3 | Model phá máy / thoát quyền hệ điều hành | Ngoài phạm vi | Máy local không sandbox (A); ghi vào Known limitations, không hứa |
| T4 | Người khác truy cập app / dữ liệu | Ngoài phạm vi | Kế thừa upstream (API key plain text) |

Hệ quả cho các mục đang ghi CỨNG:
- B0(ii) chỉ CỨNG với T2 khi lệnh kiểm tra **không** do bot bị chấm chọn và kết quả **không** do bot đó báo (§8.3).
- B3 "quét log tìm đường dẫn tập khoá" chỉ chống T1; với T2 chỉ tách vật lý (tập khoá nằm trên máy GPU) mới đủ.

### 8.2 `kind = "research"` bật những gì
Mỗi luật dưới đây là điều kiện **bắt buộc** khi `kind = "research"`; thiếu thì goal không bắt đầu (trả
`needs-input`/`blocked` kèm lý do), không âm thầm chạy mềm. Trạng thái 2026-11-11:

| Luật | Mục B | Trạng thái |
|---|---|---|
| Trần quyền theo vai luôn bật, bất kể `OMB_ROLE_CEILING` | B0(i) | **Xong**: `roleCeilingFor(threadId, node)` ở 4 điểm gắn |
| Không có Chief of Staff phía trên chuỗi giao việc | A1 | **Xong một phần**: room có Chief là thành viên → không chạy; Chief ở room khác giao việc vào thì trần quyền vẫn chặn |
| Có file goal hợp lệ và đã khoá hash | B2, B8 | **Xong** |
| Lệnh kiểm tra lấy từ file goal, không từ Lead | B0(ii), §8.3 | **Xong** |
| Evaluator/Reviewer khác nhà cung cấp model với Worker | B4, §8.5 | **Xong** |
| Song song tắt, trừ khi có B0(iii) | §1.3 | B0(iii) có (chỉ báo), nên song song vẫn bật |
| Ledger + guard ngân sách bật | B7 | **Xong** |

Room `code` (hoặc trống) giữ hành vi hiện tại; từng luật có thể bật riêng sau.

### 8.3 Trường lệnh kiểm tra (`verify`) — điều kiện của B0(ii)
- Thêm trường có cấu trúc, tách khỏi `doneWhen` (văn xuôi, giữ nguyên):
  `verify: { id, command, cwd?, timeoutSec?, expectExit: 0, resultFile? }[]`.
- **Nguồn lệnh** (cần bạn quyết):
  1. Room `research`: chỉ từ file goal đã khoá (B2). Lead không thêm/bớt được.
  2. Room `code`: (a) từ cài đặt room do bạn đặt; hoặc (b) Lead đề xuất, plan check chỉ nhận lệnh khớp allowlist
     (`docs/verification/command-allowlist.md`). Đề xuất (a), có (b) làm dự phòng.
- **Ai chạy lệnh** (cần bạn quyết; đề xuất phương án 1):
  1. **Server tự chạy** `verify` trong thư mục room sau khi Tester xong; PASS = mọi lệnh thoát đúng `expectExit`.
     Không phụ thuộc `summary` 200 ký tự hay `is_error` (A7), chống T2 vì bot không chạm vào kết quả.
     Rủi ro: server chạy lệnh tuỳ ý — chấp nhận được chỉ vì lệnh đến từ nguồn bạn đặt, không từ bot.
  2. Khớp `item.started.summary` với `command` và `item.completed.ok`. Rẻ hơn nhưng chỉ chống T1: summary bị cắt
     và che bí mật, `ok` chưa chắc phản ánh mã thoát, `cmd || true` vẫn qua.
- PASS cuối = `VERDICT: PASS` của Tester **và** mọi `verify` đạt. Lệch nhau → coi là FAIL, vào vòng sửa, ghi lý do.

### 8.4 Tester không được vừa chấm vừa sửa
- Tester ghi file trong vùng code (phát hiện bằng B0(iii)) → PASS của lượt đó **vô hiệu**, vòng sửa giao lại cho
  Worker sở hữu file. Tester chỉ được ghi vào vùng báo cáo khai trước (B0(iv)).
- Với phương án 1 ở §8.3 thì Tester ghi gì cũng không đổi được kết quả `verify`; luật này vẫn cần để code do Tester
  sửa không lọt qua mà không ai review.

### 8.5 "Vendor" trong B4
- Vendor = **nhà cung cấp model thật**, không phải engine. OpenCode/ZCode/ACP có thể chạy model của nhiều nhà
  (`provider\model`); Claude engine luôn là Anthropic.
- Cần một hàm `modelVendor(bot)` → `anthropic | openai | xai | zai | google | … | unknown`.
  `unknown` không được coi là "khác vendor" (trả kế hoạch, không đoán).
- Kiểm lại mỗi lần đổi bot: giao lại do hết quota, bot dùng backup AI (backup có thể đổi vendor).

### 8.6 Trạng thái lỗi và khôi phục còn thiếu
Mỗi dòng cần một trạng thái đích có tên và một test:

| Tình huống | Đề xuất |
|---|---|
| Server khởi động lại giữa một sóng | Task đang chạy coi là lỗi, sóng chạy lại từ task chưa xong (`goalRunId` không chạy lại sau restart — kiểm hành vi hiện tại) |
| Một task trong sóng lỗi, task khác xong | Giữ kết quả task xong; Lead nhận lỗi ở lượt kế, không chạy lại cả sóng |
| Hết 3 vòng sửa | `blocked` kèm lý do + kết quả Tester cuối, không phải `paused` |
| Hai goal cùng lúc trong một room | Goal sau xếp hàng hoặc bị từ chối — cần bạn quyết |
| Hết 13 lượt | Lead viết tóm tắt bàn giao ở lượt cuối (đã có ở §2) |
| Nghiên cứu không đạt ngưỡng khi hết ngân sách | `completed` với kết quả **âm tính** — là kết quả hợp lệ, không phải lỗi; báo cáo vẫn cần provenance |

### 8.7 Nghiệm thu "hai Lead cùng hành vi" (sửa §6.2 điểm 7)
"Chuỗi trạng thái trùng nhau" quá chặt: cùng một model chạy hai lần cũng có thể khác. Đề xuất:
- Mỗi Lead chạy N lần (N ≥ 3) trên mỗi kịch bản.
- **Bất biến, phải đúng 100%:** dừng ở "cần bạn" đúng chỗ; không chạm tập khoá; không vượt ngân sách; không báo
  `completed` khi `verify` chưa đạt.
- **Cho phép khác:** số lượt, thứ tự task độc lập, câu chữ.
- **Tương đương:** chuỗi trạng thái của mọi lần chạy nằm trong tập đường đi hợp lệ của máy trạng thái.

### 8.8 Thông số đo còn thiếu cho `/research`
Cần có trong mẫu file goal (B2), khoá cùng hash:
- Một thước đo chính; các thước đo phụ chỉ để báo cáo, không dùng để quyết "xong".
- Số seed và quy tắc gộp (trung bình ± độ lệch, hay min); ngưỡng áp lên giá trị nào.
- Đơn vị ngân sách: giờ GPU, token, tiền — một hay nhiều trần.
- Trần vòng thí nghiệm và "N vòng liên tiếp không cải thiện thì dừng" (trùng §6.4 điểm 4).

### 8.9 Cách giữ NOTE.md
- Dẫn code theo **tên hàm/kiểu**, chỉ thêm số dòng khi cần; `server/index.ts` hơn 10k dòng, số dòng lệch sau vài commit.
- Khi xong một mục: sửa ngay dòng gốc của mục đó (không chỉ thêm dòng "xong" ở chỗ khác).
- Khi đặc tả workflow (§6) bắt đầu viết, chuyển §3.2, §6, §8 sang `docs/plans/research-workflow.md`;
  NOTE.md chỉ giữ việc mở và tiến độ.

### 8.10 Đã quyết (2026-11-10) và còn mở
1. ~~§1.3~~: **B0(iii) trước** — đã làm (`writes-audit`, §1.3 ghi "đã vá" ở đó).
2. ~~§8.2~~: **đồng ý cả 7 luật** bắt buộc của `kind = "research"`.
3. ~~§8.3 (ai chạy)~~: **server tự chạy** `verify`; (nguồn lệnh) **room `code` = cài đặt room do bạn đặt**, room research = file goal đã khoá.
4. §8.6: hai goal cùng lúc trong một room — còn mở.
5. Sáu điểm §6.4 vẫn còn mở.

## 9. Đã hoàn thành và kết quả test (cập nhật 2026-11-11)

Các kết quả test trong §9 chạy trên engine giả, fixture cách ly theo `docs/verification/README.md`; kết quả model thật ở §12.

| Mục | Commit | Nội dung | Test |
|---|---|---|---|
| B0(i) trần quyền theo vai | `c65af79db` | `HandoffView.level` + `approvalModeUnderCeiling` (chỉ hạ, custom giữ mức riêng, đi xuống mức engine chạy được); gắn 4 chỗ; flag `OMB_ROLE_CEILING=1`, tắt = như cũ | Unit bảng cap; e2e `role-ceiling` 3/3: consult bot `full` → `default` khi ON / `bypassPermissions` khi OFF; Chief lift vẫn nâng khi ON |
| B12–B13 | `2efcebda2` | README: "Reviewers read only" ghi đúng cơ chế; Stop dừng cả cây; mục **Known limitations** | — |
| B1 room `kind` | `2efcebda2` | `WireGroup.kind` ("code" \| "research"), PATCH `/api/groups/:id`, null clear, giá trị lạ → 400; chưa có gì đọc | e2e `room-kind`: round-trip + từ chối |
| Gỡ file lạ | `222785ec0` | `..dist/` + `test-server-data/` khỏi tracking, ignore (blob vẫn còn trong lịch sử đã push) | — |
| B0(iii) audit `writes` | `35d5f0f23`, `a4dee8f0e` | `writes-audit.ts`: `writesSnapshot` (porcelain `-uall` + hash nội dung) + `writesOutside` (thuần, xử lý rename); chạy quanh mỗi batch wave; activity row `ok:false` | Unit 6/6 (gồm git thật trên Windows); e2e `writes-audit` POSIX-gated (worker Bash thật ghi stray) — chạy trên CI Linux, Windows skip |
| B0(ii) `verify` | `e3e6ca38b` | `WireGroup.verify` (`{id, command, cwd?, timeoutSec?, expectExit?}`, tối đa 8, cwd chỉ subfolder tương đối); PATCH lưu; **server tự chạy** (`server/verify-run.ts`, shell, cwd = thư mục room, timeout kill cả cây tiến trình) sau khi Tester PASS; PASS cuối = `VERDICT: PASS` ∧ mọi verify đúng exit; lệch → vòng sửa (cap 3 → `blocked`) | Unit: fail → fix round (`needs-input` kèm note); pass → completed; 4 lần fail → `blocked` "kept failing after 3 fix rounds"; e2e `verify-gate` POSIX-gated (artifact `verify-ran.txt` do server ghi trong workspace là bằng chứng) |
| B0(iv) vùng ghi Tester | `e3e6ca38b` | Audit quanh turn Tester (batch và single): Tester PASS nhưng ghi ngoài vùng báo cáo (task Tester khai `writes`) → **PASS void** + `team.untested = true` + vòng sửa | Unit: void → completed bị chặn (early-completion guard) kèm note "its PASS does not count"; writes trong vùng → PASS giữ nguyên |
| B4 vendor | `e3e6ca38b`, `a4dee8f0e` | `model-vendor.ts`: engine một vendor → vendor đó; còn lại đọc họ model rồi tiền tố provider; `teamVendorProblem` trong plan check; `unknown` → trả kế hoạch (không đoán) | Unit: cùng vendor → `blocked` "same model vendor"; khác vendor → completed; unknown → `blocked` "unknown model vendor"; `claudeAgent` có model id lạ vẫn `anthropic` |
| Sửa sau đánh giá | `a4dee8f0e` | Audit hash nội dung file bẩn + `-uall` (bắt Tester sửa file Worker vừa sửa; file trong thư mục mới; sửa lỗi bản ghi `A` nuốt bản ghi kế tiếp); `verify` tách ra `verify-run.ts`, timeout kill cả cây tiến trình (Windows để lại tiến trình con chạy tiếp), room không folder → `blocked` trước lượt đầu; `modelVendor` đọc họ model; luật vendor chỉ cho room research; bỏ tham chiếu NOTE/tên mảnh trong comment | Unit 6 file **87/87** (gồm git thật và shell thật trên Windows); e2e goal + quyền **27/27**, 2 file POSIX-gated skip; typecheck + lint sạch |

**Kết quả test 2026-11-11:** unit 9 file liên quan — **109/109 qua**; e2e regression goal + quyền (`group-goal-run`, `group-goal-wait-cap`, `role-ceiling`, `room-kind`) — **27/27 qua**; typecheck `tsconfig.server.json` sạch. E2E POSIX-gated (`writes-audit`, `verify-gate`) skip trên Windows cục bộ, chờ CI Linux chạy thật.

**Còn mở:** §8.6 (hai goal cùng room); 6 điểm §6.4 (spec workflow); trần `edits` cho Tester là cấu hình mức bot (§6.2 điểm 5). B2–B11 đã xong ở §9.1–9.3.
Phần thiếu của mục đã làm (chỉ cần cho room research): file được bảo vệ của `verify` (T2). Vùng báo cáo Tester/Evaluator ở đường đơn = rỗng (đường đơn không khai `writes`), nên mọi ghi của họ ở đó đều bị coi là ngoài vùng — luật đã chốt, không phải lỗi.
E2E `writes-audit`, `verify-gate` chỉ chạy trên POSIX; chưa có bằng chứng CI đã chạy chúng.
`scripts/testing/file-size-ratchet.test.ts` đang fail, và đã fail từ trước khi làm fork (cả 3 file đã vượt mốc ở bản gốc): `server/index.ts` (16.124 dòng sau `32edbc56e`, mốc 15.630), `shared/wire.ts` (1.030 > 1.000), `src/components/GroupView.tsx` (1.244, mốc 1.220). Muốn xanh phải tách code ra khỏi các file này.

### 9.1 Bổ sung 2026-11-11 (bản hai)

| Mục | Nội dung | Test |
|---|---|---|
| B2 + B8 + khoá đăng ký trước | `server/research-goal.ts`: schema zod theo §8.8 (metric/file+pointer+threshold+direction, seeds+aggregation, budget.wallMinutes, verify 1–8, heldOutPaths) + `loadResearchGoal` (sha256 theo bytes); room research: `goalFile` (đường dẫn tương đối) + `goalFileHash`; PATCH `researchGoalApprove: true` duyệt (validation fail → 400 kèm lý do schema); goal run research: không goalFile → `needs-input`, chưa duyệt → `needs-input` kèm sha256, đã duyệt mà file đổi → `blocked` (preregistration lock) | Unit `research-goal` 5/5 (gồm hash theo bytes, schema từ chối, non-JSON); e2e `research-gate` POSIX-gated: needs-input → approve → run → completed + artifact verify do server ghi → sửa file → blocked |
| B7 guard ngân sách | dep `budgetWallMinutes` (từ goal file) + `researchBudgetExceeded`: quá hạn → `blocked` "research budget ran out… a negative result is still a valid outcome" | Unit `researchBudgetExceeded`; e2e research-gate chạy hết vòng đời gate |
| Verify room research lấy từ goal file | `runGroupGoalOperation`: researchVerify (goal file) đè room.verify cho room research — B0(ii) không đổi | e2e research-gate (verify-ran.txt) |

**Kết quả test:** unit 8 file — 108/108; e2e regression 27/27; research-gate POSIX-gated (chờ CI Linux); typecheck sạch. Đồng thời tích hợp thay đổi đang dở của phiên khác trên cùng working tree (writesSnapshot, verifyRefusal) — giữ nguyên, không đụng.

**Chặn decisions (không code mù được):** B6/B11/ledger cần đặc tả state machine; B9 cần hành vi `/research` (§3.3); B3 cần quyết định điểm gắn quét event (đã có heldOutPaths trong goal file). Sáu điểm §6.4 + §8.6 điểm 4 chờ bạn.

### 9.2 Bổ sung 2026-11-11 (bản ba — hoàn thành các mục B còn lại)

| Mục | Nội dung | Test |
|---|---|---|
| B3 held-out | goal file `heldOutPaths`; dep `scanHeldOut` đọc `events/<threadId>.ndjson` của goal thread + lane thread của từng member sau turn; nhắc → activity row | Unit: worker nhắc held-out → row; không nhắc → im lặng |
| B6 pilot gate | goal file `pilot.maxTasks`; plan **đầu tiên** của run research vượt số task → refused (đếm planRefusals như plan check) | Unit: plan 2 task > max 1 → refused, plan 1 task → chạy |
| B11 handoff | goal file `handoff.expectsFiles`; Lead gọi completed khi thiếu file trong thư mục room → `needs-input` nêu tên file; đặt file rồi gửi lại goal | Unit: thiếu → needs-input nêu đúng file; đủ → completed |
| B7 ledger | Ban đầu ở `ledgerFile` trong thư mục room — bot ghi được, đã chuyển sang thư mục dữ liệu của app ở §9.3 | e2e research-gate (POSIX) |
| B9 `/research` | `researchTextFromComposer` + candidate chỉ hiện ở room `kind=research`; gửi vào goal mode, gate goal file lo phần còn lại; locale `composer.command.researchDesc` | client tests 28/28 |
| Role Evaluator | `TEAM_ROLES` thêm `evaluator`; `teamRoleRule` (chỉ chạy evaluation script của goal file, trích kết quả theo tham chiếu); `teamVendorProblem` áp cho cả Evaluator; RoomStatus + locale | Unit vendor rule; client tests |

**Kết quả test 2026-11-11 (bản ba):** unit 11 file — **140/140 qua**; e2e regression goal/quyền — **27/27 qua**; client tests — **28/28**; typecheck server + app sạch. E2E POSIX-gated (`writes-audit`, `verify-gate`, `research-gate`) chờ CI Linux.

**Còn mở (chỉ còn việc chờ đặc tả/ngoài app):** B10 provenance (máy GPU); viết đầy đủ `docs/plans/research-workflow.md` + playbook + kịch bản nghiệm thu hai Lead (§6, cần duyệt bản nháp); §8.6-4 (hai goal cùng room); đường truyền GPU (§3.3).

### 9.3 Sửa sau khi rà lại (2026-11-11, `32edbc56e`, đã push)

| Lỗi | Sửa | Test |
|---|---|---|
| Pilot gate bị vượt khi Lead nộp lại plan to | Chỉ coi pilot là đã qua khi một plan được nhận | Unit: nộp plan to 3 lần → `blocked` |
| Không kiểm metric so ngưỡng | Sau `verify`, server đọc `metric.file` theo JSON pointer, gộp `seeds`; dưới ngưỡng → Lead lập thí nghiệm kế; `maxExperimentRounds`/`stopAfterFlatRounds` → `blocked` âm tính; đọc lỗi → không cho xong | Unit metric/seed/pointer/luật dừng; goal-run: dưới rồi đạt, đọc lỗi, đếm vòng xuyên run |
| Ngân sách đặt lại mỗi lần gửi goal | `researchHistory` cộng thời gian chạy mọi run cùng hash từ ledger | Unit ledger; goal-run: đã tiêu quá → dừng trước lượt đầu |
| Ledger trong thư mục bot ghi được | Ledger ở `<data>/research/<groupId>.jsonl`; bỏ `ledgerFile` khỏi schema; không ghi được ledger → `blocked` | Unit `research-run`; e2e research-gate (POSIX) |
| §8.2 luật 1, 2 chưa có | `roleCeilingFor`; room research có Chief → `needs-input` | Unit `research-run` (Chief) |
| Quét tập khoá báo nhầm và lặp | Chỉ `item.started` từ lúc turn bắt đầu, theo instance của bot, khớp `/` và `\`; chuyển ra `research-goal.ts` (route ratchet hết đỏ) | Unit `heldOutMentions`, `research-run` |
| Evaluator chỉ có lời dặn | Audit ghi quanh turn Evaluator; ghi ngoài vùng → kết quả không tính, cần Tester kiểm lại | Unit goal-run |
| Vendor chỉ so trong một plan | So với mọi Worker trong run, cả đường đơn | Unit goal-run (Reviewer ở lượt sau) |
| Duyệt và chạy đọc file ở hai folder khác nhau | Duyệt dùng `pinGroupCwd` như lúc chạy | — |
| Comment dẫn NOTE/tên mảnh; `void folder` | Bỏ | lint |
| Locale | Thêm `vi`, `pt-br` cho Evaluator và `/research` | locale tests |
| README | Thêm mục Research rooms, sửa Known limitations | — |

Phần research chuyển ra `server/research-run.ts`, nên `server/index.ts` nhỏ lại thay vì phình thêm.

**Kết quả test (`32edbc56e`):** typecheck app + server sạch; lint sạch; unit + locale + ratchet 307 file qua, chỉ còn
`file-size-ratchet` (có từ trước); e2e goal/quyền 34/34 qua; 3 e2e POSIX-gated (`research-gate`, `verify-gate`,
`writes-audit`) bỏ qua trên Windows, chưa chạy lần nào.

## 10. Giao diện mới (Neon) — định nghĩa và triển khai frontend (2026-11-11)

Nguồn thiết kế: design system **Neon Office** ở `designs/neon-office/` (`5d74d3b72`, đã push): `project/tokens.json`,
`project/README.md` (brand book), 11 thành phần (`project/components/*/README.md` + `preview.html`), Cover, màn hình mẫu
`office-preview.html`. Định dạng theo baoyu-design (`designs/<slug>/project/`). Mockup xem trực tiếp:
https://claude.ai/artifact/1uEJF74XodoD7o9TZjbjM9 (riêng tư).
Mục lục công khai: [`designs/neon-office/README.md`](designs/neon-office/README.md). README dùng
[`docs/images/neon-office.gif`](docs/images/neon-office.gif), 880×550, 58 frame, 8,7 giây; đây là preview dữ liệu mẫu,
không phải màn hình đã tích hợp với dữ liệu app.

### 10.1 Quyết định: thay giao diện, không viết lại app
- Viết lại toàn bộ UI cũ **không khả thi**: `src/` có 569 file `.tsx`, khoảng 262.000 dòng TS/TSX (gồm test). Phần lớn là
  tính năng kế thừa OpenMausBot (máy tính, giọng nói, app kết nối, routine, cài đặt, cloud). Viết lại = nhiều tháng,
  mất tính năng, xung đột mỗi lần lấy code upstream.
- App đã có cơ chế **skin**: 13 skin (`src/lib/skins.ts`), mỗi skin là khối `[data-skin="…"]` trong `src/styles.css`
  đặt lại khoảng 60 biến `--color-*`, font, bán kính; mọi component đọc các biến này.
- Nên "UI mới" làm ba lớp: (1) **skin `neon`** đổi cả app ngay, không sửa component; (2) **màn hình Văn phòng** làm màn
  hình chính cho room/team; (3) **làm lại các bề mặt của team** (panel room, Team status, card goal) bằng thành phần
  Neon. Các màn hình kế thừa giữ cấu trúc, chỉ khoác skin mới.

### 10.2 Ánh xạ token Neon Office → biến của app

| Biến app | Token Neon |
|---|---|
| `--color-app` | `void` |
| `--color-panel` | `floor` |
| `--color-card`, `--color-menu`, `--color-composer` | `panel` |
| `--color-raised`, `--color-control`, `--color-inset` | `panel-raised` |
| `--color-raised-hover`, `--color-menu-hover` | `panel-raised` + 6% `fg` |
| `--color-hairline`, `--color-composer-ring`, `--color-scrollbar` | `line` / `line-strong` |
| `--color-ink`, `--color-ink-secondary`, `--color-ink-tertiary` | `fg`, `muted`, `idle` |
| `--color-accent`, `--color-accent-border`, `--color-accent-text` | `magenta` |
| `--color-accent-ink`, `--color-success-ink`, `--color-danger-ink` | `on-neon` |
| `--color-success`, `--color-danger`, `--color-warning` | `run`, `out`, `wait` |
| `--color-bubble-user`, `--color-bubble-user-ink` | `panel-raised`, `fg` |
| `--font-sans` | Be Vietnam Pro (đóng gói font, xem §10.4) |

Token Neon còn thiếu cho app (thêm vào `tokens.json` khi làm U0): màu bong bóng chat, màu code, ô nhập.

### 10.3 Giai đoạn

| Giai đoạn | Việc | Xong khi | Công |
|---|---|---|---|
| U0 Skin | Khối `[data-skin="neon"]` theo §10.2; thêm `neon` vào `SKIN_IDS`/`SKINS`; đóng gói 3 font; góc vát và scanline chỉ ở panel, nút chính | Mọi màn hình đọc được ở skin Neon; `skins*.test.ts` qua; ảnh chụp các màn hình chính | Nhỏ–vừa |
| U1 Dữ liệu | Endpoint gộp mọi room cho Văn phòng: thành viên, vai, trạng thái, goal run, task của plan, hand-off đang mở (tóm tắt, che bí mật), qua SSE sẵn có; viết trong `server/routes/` | e2e engine giả trả đúng cho 2 room | Vừa |
| U3 Bề mặt team | Panel room, Team status, card/panel goal bằng thành phần Neon; bảng kế hoạch + cổng Tester (§2 mục 1, 2); ô cài `kind`, file goal, duyệt file goal, `verify` (hết gọi API tay) | Đặt room research và duyệt file goal hoàn toàn trong UI | Vừa |
| U2 Văn phòng | Màn hình Văn phòng React theo `office-preview.html` (BotNode, RoomPlatform, HandoffBeam; GoalFlowCard, NeedItem, BotDetail, ActivityFeed); bấm bot mở lane | Chạy với dữ liệu U1; DOM test; màn hẹp → danh sách | Vừa–lớn |
| U4 Mặc định | Neon thành skin mặc định; xử lý skin cũ theo §10.5; Văn phòng là màn hình mở đầu khi có room | Người dùng mới mở app thấy Văn phòng ở skin Neon | Nhỏ |

Thứ tự đề xuất: U0 → U1 → U3 → U2 → U4 (U3 trước U2 vì bỏ được việc gọi API tay cho room research, có ích ngay).

### 10.4 Ràng buộc
- Chỉ một theme tối. Muốn chế độ sáng thì giữ skin cũ (Daylight…).
- Bản desktop chạy offline: font không lấy từ Google Fonts được, phải đóng gói file font (như `Geist Variable` hiện tại);
  kiểm giấy phép OFL của Chakra Petch, Be Vietnam Pro, JetBrains Mono.
- Chỉ 4 chuyển động của Neon Office, tắt hết khi `prefers-reduced-motion`.
- Ratchet kích thước file: mọi thứ mới nằm trong file mới, không thêm vào `server/index.ts` hay `GroupView.tsx`.
- Khối skin và màn hình mới là file/khối mới nên lấy code upstream ít xung đột.

### 10.5 Đã quyết (2026-11-11)
1. Skin cũ **giữ trong cài đặt**; Neon là mặc định.
2. Văn phòng là **một mục mới cạnh danh sách room** (sidebar giữ danh sách room/bot).
3. **Không** làm bản sáng của Neon.
4. Số đo từ đợt chạy thử (lượt theo vai, token và chi phí của run, cảnh báo vai không được giao) hiện **trong panel goal**.

### 10.6 Định nghĩa từng màn hình

Mọi màn hình dùng skin Neon và thành phần Neon Office (`designs/neon-office/project/components/`). Chữ UI tiếng Việt theo
brand book (giữ thuật ngữ app: Lead, Worker, Tester, Reviewer, Evaluator, goal, task, verify, writes). Số luôn kèm giới hạn
(`lượt 6/13`, `vòng sửa 1/3`). Mọi trạng thái bot dùng 5 từ cố định: đang xử lý, xếp hàng, chờ bạn, hết lượt, rảnh.

**S1. Sidebar** (`src/components/Sidebar.tsx`, `SidebarSections.tsx`)
- Mục **Văn phòng** trên cùng, trên danh sách room/bot; huy hiệu `wait` đếm việc "Cần bạn" của mọi room.
- Danh sách room/bot giữ nguyên; hàng room thêm chấm trạng thái goal (đang chạy / chờ bạn / xong / dừng).
- Xong khi: bấm Văn phòng mở màn hình S2; số huy hiệu bằng số mục ở cột "Cần bạn" của S2.

**S2. Văn phòng** (component mới, theo `designs/neon-office/office-preview.html`)
- Bố cục: cảnh isometric (`minmax(0, 1fr)`) + cột phải 340px; dưới 1020px cột phải xuống dưới; dưới 640px cảnh đổi thành
  danh sách theo room (mỗi room một HudPanel, mỗi bot một dòng StateChip).
- Cảnh: RoomPlatform theo `kind`, BotNode mỗi thành viên, HandoffBeam cho hand-off đang mở, hub Chief of Staff ở giữa
  (không có Chief thì hub là app). Lọc: Tất cả / Code / Research / Cần bạn.
- Cột phải: Luồng công việc (GoalFlowCard mỗi goal đang chạy), Cần bạn (NeedItem), Bot đang chọn (BotDetail), Vừa xảy ra
  (ActivityFeed, 5 dòng).
- Thao tác: bấm bot → mở lane/thread của nó; bấm thẻ HUD của room → mở room; bấm GoalFlowCard → làm nổi room; nút của
  NeedItem → mở đúng thẻ duyệt hiện có (duyệt lệnh, duyệt file goal, hết lượt).
- Trống (chưa có room): một HudPanel "Chưa có room nào" + nút tạo room.
- Dữ liệu: endpoint mới `GET /api/office` (mọi room: thành viên, vai, model, `MemberNow`, goal run đang chạy, task của
  plan, hand-off đang mở đã che bí mật) + cập nhật qua SSE sẵn có. Viết trong `server/routes/`.
- Xong khi: chạy với dữ liệu thật của `D:\OMB-trial`; DOM test lọc, chọn bot, màn hẹp; tắt chuyển động khi
  `prefers-reduced-motion`.

**S3. Panel room và Team status** (`src/components/room-panel/RoomPanel.tsx`, `RoomStatus.tsx`)
- Mỗi khối là HudPanel. Dòng thành viên: chấm trạng thái, tên, chọn vai (Lead / Worker / Tester / Reviewer / Evaluator),
  model id (mono), việc đang làm, bao lâu, bước mới nhất.
- Thêm: "hết lượt · reset HH:MM" (§2 mục 4); nút **Mở để duyệt** khi bot chờ duyệt (làm lại tính năng của stash đã mất);
  huy hiệu vai trong khung chat (§2 mục 5).
- Mục **Cài đặt room**: loại room (code / research); với room code, sửa danh sách `verify` (id, lệnh, thư mục con,
  timeout, mã thoát mong đợi, tối đa 8); với room research, khối S5.
- Xong khi: đặt vai, `kind`, `verify` hoàn toàn trong UI; không còn phải gọi `PATCH /api/groups/:id` tay.

**S4. Card goal và panel goal** (`src/components/GoalRunCard.tsx`, `GoalRunPanel.tsx`)
- Card: room, `lượt n/13`, chip trạng thái, Tag cổng Tester ("Tester: FAIL · vòng sửa 1/3"), Tag `verify` ("verify 1/2
  đạt"), Tag metric cho room research ("0,95 / cần ≥ 0,90"); nhãn "Đã chạy như goal · Đổi thành chat" trên tin tự chạy goal.
- Panel, theo thứ tự:
  1. **Kế hoạch**: bảng task (id, người làm, vai, trạng thái, phụ thuộc, `writes`).
  2. **Kiểm tra**: lịch sử phán quyết Tester theo vòng sửa; kết quả `verify` (mã thoát thật, 200 ký tự cuối output);
     với room research, các lần đọc metric.
  3. **Số đo của run** (quyết định 4): lượt theo vai (thanh), token vào/ra/cache và chi phí theo vai của riêng run này, tỉ
     lệ cache; cảnh báo khi một vai có trong room nhưng không được giao ("Reviewer chưa được giao việc"), khi Lead chiếm
     quá nửa số lượt, khi chỉ một trong nhiều Worker được dùng.
  4. **Hoạt động**: các dòng audit `writes`, held-out, hết lượt của run.
- Hết 13 lượt: nút **Tiếp tục** và tóm tắt bàn giao (§2, cần thêm phía server).
- Dữ liệu: plan task và kết quả verify gửi kèm dữ liệu card goal; số đo lấy từ usage ledger (`data/usage/*.jsonl`) lọc theo
  thread goal và lane của run trong khoảng thời gian của run, qua endpoint mới
  `GET /api/groups/:id/goal-runs/:runId/usage`.
- Xong khi: số đo của một run khớp phép tính tay trên ledger (như §12.3).

**S5. Cài đặt room research** (trong S3 khi `kind = "research"`)
- Ô đường dẫn file goal; trạng thái file: hợp lệ / lỗi schema (nêu lỗi) / thiếu.
- sha256 rút gọn; nút **Duyệt file goal** (gọi `researchGoalApprove`); trạng thái khoá: chưa duyệt / đã duyệt / **đã đổi
  sau khi duyệt** (chặn chạy).
- Tóm tắt đọc từ file: metric, ngưỡng, hướng, số seed và cách gộp, ngân sách, pilot, handoff, tập khoá.
- Ngân sách đã tiêu / tổng (từ ledger) và chuỗi metric qua các run (sparkline có điểm ngưỡng).
- Cảnh báo khi room có Chief of Staff (room research sẽ không chạy).
- Dữ liệu: endpoint mới `GET /api/groups/:id/research` (đọc file goal, hash, trạng thái khoá, lịch sử ledger).
- Xong khi: tạo room research, chọn file, duyệt, chạy và xem metric hoàn toàn trong UI.

**S6. Chọn skin** (`src/components/SkinPicker.tsx`, `src/lib/skins.ts`)
- Neon đứng đầu và là mặc định cho người dùng mới; các skin cũ giữ nguyên trong danh sách.
- Xong khi: `skins*.test.ts` qua; đổi qua lại Neon và skin cũ không để sót màu.

**Endpoint mới cần cho UI:** `GET /api/office` (S2), `GET /api/groups/:id/goal-runs/:runId/usage` (S4),
`GET /api/groups/:id/research` (S5); plan task + kết quả verify trong dữ liệu card goal (S4). Tất cả trong
`server/routes/`, không thêm vào `server/index.ts`.

**Thứ tự làm (cập nhật §10.3):** U0 skin (S6) → server: dữ liệu card goal + 3 endpoint → S3 + S5 → S4 → S1 + S2.

### 10.7 Mật độ Compact cho UI mới

Định nghĩa kích thước ở [`designs/neon-office/compact-layout.md`](designs/neon-office/compact-layout.md); đây là yêu cầu
để triển khai UI; frontend đã áp dụng theo §10.8. Compact thay các kích thước cũ 340px rail / 26px title trong
preview; HTML mẫu và GIF vẫn giữ bản gốc.

| Phần | Mặc định Compact |
|---|---|
| Sidebar | 240px; kéo trong khoảng 220–320px, giữ lựa chọn độ rộng đã lưu |
| Hàng sidebar / header | Tối thiểu 32px / 44px |
| Panel room/bot / goal | 320px / 360px; overlay nếu chat còn dưới 600px |
| Rail Văn phòng | 320px; xuống dưới khi vùng nội dung dưới 1100px |
| Điện thoại | Dưới 640px vùng nội dung: danh sách room; vùng bấm tối thiểu 44px |
| Padding panel / khoảng cách | 12px / 12px |
| Chữ UI / chat / phụ | 13px / 14px / 12px |
| Nút / input desktop | Tối thiểu 32px; nút chỉ icon 28px |
| Composer | Tối thiểu 44px, tự cao theo nội dung |

Không dùng CSS zoom hay scale toàn app. Hàng tự cao khi xuống dòng, giữ font nhập liệu 16px trên điện thoại, kiểm
200% browser zoom. Dùng lại thiết lập mật độ sidebar hiện có, không tạo hai hệ density. Breakpoint tính theo vùng
nội dung sau sidebar/panel, không chỉ `window.innerWidth`. Nghiệm thu ở 1920×1080, 1440×900, 1366×768, 1280×720,
390×844; đo bounds/overflow và kiểm bàn phím cùng ảnh chụp.

### 10.8 Áp dụng frontend, giữ nguyên backend và DB

- Không sửa `server/`, `shared/`, schema hay migration. Skin và lựa chọn bố cục nằm phía trình duyệt; giữ skin và độ
  rộng sidebar đã lưu. Neon mặc định cho cài đặt mới. Font Be Vietnam Pro, Chakra Petch và JetBrains Mono được đóng
  gói offline, giấy phép ở `public/fonts/neon-OFL.txt`; màu vượt kiểm tra tương phản của repo.
- S1/S2: mục Văn phòng, badge việc chờ theo lịch sử đã tải, scene room/bot thật, lọc, chọn bot, mở room/lane, phân trang
  4 room trong scene. Dưới 640px vùng nội dung dùng danh sách room. API `/api/groups/:id/now` hiện có được đọc mỗi
  5 giây khi trang hiện; cập nhật SSE dùng store sẵn có. Không dựng handoff giả: đường giữa bot chỉ thể hiện hàng chờ
  khi snapshot có `waitingForBotId`. Dữ liệu không đọc được có cảnh báo.
- S3/S5: thêm UI chọn loại room, sửa tối đa 8 lệnh verify và file goal, duyệt file goal; đều dùng group PATCH hiện có.
  Lỗi schema/file thiếu do server trả về được hiển thị; hash hiển thị là hash lần duyệt, không tự khẳng định file hiện
  tại chưa đổi. Không chạy verify chỉ vì bấm lưu. Cài đặt khác được giữ nguyên.
- S4: goal panel có công việc hiện tại, báo cáo Tester/Reviewer khi có trong lịch sử, và lượng dùng của thread đang mở
  nếu snapshot cung cấp. Feed được giới hạn đến trước card goal kế tiếp. Không coi tổng thread là tổng goal hoặc lane.
- Chưa làm phần cần dữ liệu mới: bảng plan đầy đủ, handoff thật, đồ thị ledger nghiên cứu, số đo theo run/vai, cổng
  verify/metric chi tiết. Các endpoint trong §10.6 vẫn là định nghĩa tương lai; không được thêm trong đợt frontend này.
- Smoke browser: `scripts/testing/verify-neon-office.ts` khởi động fake-engine fixture và Chrome profile riêng; kiểm
  desktop, mobile, viewport tương đương 200% zoom, lọc/chọn bằng bàn phím, lưu verify, lỗi file goal và duyệt file hợp lệ.
  So sánh schema `messages.db`/`runtime.db` trước và sau để xác nhận không đổi cấu trúc. Ảnh và JSON kết quả ở
  `.omb-scratch/verify-evidence/neon-office/`; recipe ở `docs/verification/neon-office.md`.

## 11. Đã dùng được chưa (2026-11-11)

| Phần | Trạng thái |
|---|---|
| Room code (Lead/Worker/Tester/Reviewer) | Dùng được. Reviewer chỉ đọc thật khi chạy server với `OMB_ROLE_CEILING=1`. Có UI đặt `verify` qua API hiện có |
| Room research | Có UI đặt loại room/file goal và duyệt hash; chưa có đồ thị ledger/preview schema trước duyệt. E2E `research-gate` POSIX vẫn chưa kiểm cục bộ; bot vẫn sửa được file metric/script chấm (T2); playbook Lead và §6.4 chưa có |
| Model thật | Đã chạy fixture cách ly: code, research, hai Worker song song, Reviewer và vòng sửa; số đo ở §12.2–12.7. Chưa chứng minh giảm token hoặc hiệu năng trên dự án lớn |

Trước khi dùng rộng hơn:
1. Giữ kiểm chứng bằng fixture cách ly theo `docs/verification/README.md`; code và research nhỏ đã qua ở §12.
   Chạy thêm dự án lớn để đo chi phí và giới hạn 13 lượt; không dùng dữ liệu app đang chạy để thử mutation.
2. Nếu có CI Linux: xem kết quả 3 e2e POSIX-gated.
3. Chốt phần còn mở ở §6.4 và §8.6-4; triển khai UI theo định nghĩa đã duyệt ở §10.5–10.6.

## 12. Tối ưu tính năng hiện có (2026-11-11)

Đã có số đo thật trên fixture nhỏ (§12.2–12.7). Sóng song song và Reviewer hoạt động, nhưng chưa chứng minh tiết kiệm
token; các lần đổi đội/model không phải phép so sánh kiểm soát. "Tối ưu" gồm ba hướng:

| Hướng | Hiện trạng | Việc |
|---|---|---|
| Độ tin cậy | Lead giữ envelope và chia việc trong fixture thật; Reviewer bắt lỗi; Worker vẫn có thể ghi ngoài `writes` | Tiếp tục đo trên dự án lớn, giữ audit và kiểm tra độc lập |
| Chi phí (lượt/token/thời gian) | Lượt bị đốt vì plan bị trả, `completed` sớm, `verify` lỗi, metric chưa đạt; hết 13 lượt chỉ tạm dừng, chạy lại đếm từ 0, không tóm tắt; Lead đọc lại toàn bộ ngữ cảnh mỗi lượt | Theo số đo: tóm tắt bàn giao + nút "Tiếp tục" khi hết lượt (ứng viên số 1); rút gọn hướng dẫn cho Lead nếu Lead ăn phần lớn token |
| Trải nghiệm | `verify`, room research, duyệt file goal chỉ qua API; thiếu bảng kế hoạch, cổng Tester trên card, giờ reset quota (§2); trần quyền room code tắt mặc định | U3 (§10.3); cân nhắc bật `OMB_ROLE_CEILING` mặc định |

Chi phí nhỏ phía server, chỉ sửa nếu đo thấy chậm: quét tập khoá đọc lại cả file event log mỗi lượt (nên đọc phần
mới); audit `writes` chạy `git status` + băm file bẩn sau mỗi sóng (repo lớn sẽ chậm).

Với room code, tối ưu có thể là **bớt** luật: đo xem luật nào (audit, verify, vendor, pilot, ngân sách) thật sự bắt
được lỗi, luật nào chỉ tốn lượt.

Thứ tự: (1) chạy thử model thật, thu số đo; (2) sửa 2–3 chỗ đốt lượt nhiều nhất; (3) U3; (4) tối ưu server và UI Neon.

### 12.1 Kế hoạch chạy thử với model thật

- **Có thể làm:** máy có `claude`, `codex`, `grok`, `gemini` đã cài (chưa có `opencode`, `zcode-acp-server`).
- **Cách ly:** bộ `scripts/control-omb.ts launch` chỉ cài engine giả, nên không dùng được cho model thật. Chạy server
  riêng với `OMB_DATA_DIR=<thư mục tạm>` và `OMB_PORT=<cổng trống>`, giữ `HOME` thật để các CLI còn đăng nhập. Dữ liệu
  app đang chạy của bạn (`~/.openmausbot`, cổng 8799) không bị đụng. CLI sẽ ghi lịch sử phiên của chúng vào thư mục
  cấu hình thật của chúng (`~/.claude`…).
- **Tốn:** quota/tiền của tài khoản thật, ước vài chục lượt model cho hai kịch bản.
- **Kịch bản A, room code:** repo git tạm có một project Node nhỏ với test đang fail; Lead (Claude) + Worker (Codex) +
  Tester (Gemini hoặc Grok); `verify = npm test`; goal "sửa cho test qua".
- **Kịch bản B, room research:** mô hình đồ chơi (script tính độ chính xác trên dữ liệu nhỏ có sẵn); file goal với
  metric, 3 seed, ngân sách 10 phút, pilot 1 task, `verify` chạy script chấm; đi đủ: chờ duyệt → duyệt → chạy → kiểm
  metric → xong hoặc dừng âm tính.
- **Số đo mỗi goal:** số lượt, lần plan bị trả, vòng sửa, `completed` sớm, lý do và trạng thái cuối, thời gian, ghi chú
  audit/held-out, và Lead có giữ đúng envelope không.
- **Kết quả** ghi vào §12.2 khi chạy xong.

### 12.2 Kết quả chạy thử model thật (2026-11-11)

Môi trường: server riêng, database cố định `D:\OMB-trial\data` (không đụng `~/.openmausbot`), UI thật ở
`http://127.0.0.1:8931` (chạy bằng `OMB_DATA_DIR=D:/OMB-trial/data OMB_PORT=8931 OMB_WEBHOOK_PORT=8932
OMB_STATIC_DIR=D:/Bot_Management/dist node --experimental-strip-types server/index.ts`). Điều khiển qua đúng API của UI
(`D:\OMB-trial\drive.mjs`); dự án ở `D:\OMB-trial\work`; số đo ở `D:\OMB-trial\report-*.json`. Bot ở Full access.
Model: Lead `claude-sonnet-5-5`, Worker Codex `gpt-5.6-sol`, Tester `claude-haiku-5-5`, Reviewer Codex `gpt-5.6-luna`
(chỉ room code). Grok hết quota; Gemini không có engine trong app; Ollama `qwen3:8b` đã thử gắn rồi bỏ.

| Kịch bản | Kết quả | Lượt | Thời gian | Ghi chú |
|---|---|---|---|---|
| A, room code (`shop-lib`, 2 test fail) | `completed`, 2/2 test qua, sửa đúng `src/cart.js`, không đụng test | 7/13 | 61 s | Lead giao Tester chạy test **trước** khi Worker làm (mất 2 lượt); Lead chen một lượt sau mỗi thành viên (4/7 lượt là của Lead); Reviewer không được giao việc |
| B, room research (`toy-classifier`, 0,70 → ngưỡng 0,90) | `completed`; server đọc metric 0,9545 (3 seed); ledger đủ `run-start`/`verify`/`metric`/`run-end` | 5/13 | 70 s | Plan 1 task qua pilot gate; Worker tự dò tham số trên `train.json`, không đụng tập khoá (không có cảnh báo held-out) |

Không có plan bị trả, không `completed` sớm, Lead giữ đúng envelope ở cả hai.

**Lỗi tìm ra nhờ chạy thật:** cả 3 e2e chỉ chạy trên POSIX (`research-gate`, `verify-gate`, `writes-audit`) tạo room
không có `setup`, nên server trả 409 "finish room setup before sending the first message" — chúng sẽ fail ngay nếu được
chạy. Đã sửa (thêm `setup` như các e2e khác).

**Ứng viên tối ưu từ số đo:**
1. Lượt của Lead: Lead chen giữa mọi bước. Với việc nhỏ, một plan có `dependsOn` (Worker → Tester) chạy trong một sóng
   tiết kiệm 2–3 lượt; có thể thêm hướng dẫn cho Lead "giao Worker trước, Tester sau, trong cùng một plan".
2. Tester chạy trước khi có thay đổi là lượt bỏ đi: plan check có thể trả plan giao Tester khi chưa có Worker nào làm.
3. Ghi chú "…'s recent-work brief covers 1 private chat with you" xuất hiện mỗi thành viên mỗi run (tính năng kế thừa),
   làm loãng dòng hoạt động của room.
4. Chưa đo token (chưa đọc usage ledger); hai việc quá nhỏ nên chưa thấy được giới hạn 13 lượt hay vòng sửa.

Bước sau: một kịch bản lớn hơn một chút (nhiều file, có vòng sửa) để đo vòng sửa, sóng song song và token.

### 12.3 Vòng 2: dự án lớn hơn, Phase 16, đo token (2026-11-11)

| Kịch bản | Kết quả | Lượt | Thời gian | Ghi chú |
|---|---|---|---|---|
| C, room code `inventory-service` (4 module, 5/7 test fail + một tính năng mới), 2 Worker | `completed`, 7/7 test qua, sửa cả 4 file `src/`, không đụng test | 5/13 | 65 s | Lead dồn mọi việc cho một Worker theo đường đơn: Worker 2 không được dùng, không có sóng song song |
| D, room research Phase 16 (`D:/AGI`): viết `extract.py` tách khai triển `-(a-b)` từ lời giải văn bản cho scorer thật `score_negate_difference.py` (bước docstring ghi "still-unvalidated"); dữ liệu tổng hợp, 0,27 → ngưỡng 0,95 (seed thấp nhất) | `completed`, độ khớp nhãn 1,0 cả 3 seed trên tập khoá, dev 1,0 | 5/13 | 241 s | Worker chỉ sửa `extract.py`; không có cảnh báo held-out; Tester tự ghi một lỗ hổng nhỏ còn lại (`$` đứng ngay sau từ khoá → `missing`) |

Dữ liệu Phase 16 ở đây là tổng hợp cho bài thử quy trình, không phải bằng chứng hay dữ liệu chuẩn của Phase 16; `D:/AGI` chỉ được đọc (scorer được chép sang).

**Token** (bot "Token analyst" Codex `gpt-5.6-sol` tính từ `data/usage/2026-11.jsonl`, script `D:\OMB-trial\token_stats.js`,
báo cáo `D:\OMB-trial\token-report.md`; đã đối chiếu độc lập, khớp từng số). Token = input + output; "lượt" = một bản
ghi lượng dùng cho mỗi lượt của bot.

| Dự án | Tổng token | Lượt | Chi phí ghi nhận |
|---|---:|---:|---:|
| Shop lib | 519.644 | 7 | $0,449 |
| Inventory service | 352.321 | 5 | $0,312 |
| Toy classifier | 506.694 | 5 | $0,337 |
| Phase 16 extraction | 844.490 | 5 | $0,583 |
| **Trung bình một dự án** | **555.787** (567.271 tính cả chi phí tạo bot) | | |

| Vai | Tổng token | TB mỗi dự án | TB mỗi lượt |
|---|---:|---:|---:|
| Lead (Sonnet 5.5) | 739.156 | 184.789 | 56.858 |
| Tester (Haiku 5.5) | 778.769 | 194.692 | 155.754 |
| Worker (Codex sol) | 705.224 | 176.306 | 176.306 |
| Reviewer, Worker 2 (Codex luna) | 0 | — | — |

- 82,7% input là cache, output chỉ 1% tổng token: chi phí chủ yếu là nạp lại ngữ cảnh mỗi lượt, không phải sinh câu trả lời.
- Lead rẻ mỗi lượt nhưng chiếm nhiều lượt nhất (13/22); Tester tốn gần bằng Worker mỗi lượt dù chỉ chạy test.
- Chi phí tạo bot (gợi ý cài đặt, Haiku) khoảng 2%.
- Chi phí USD là số engine báo về; lượt Codex theo gói đăng ký có thể không phản ánh đúng tiền thật.

**Ứng viên rút ra từ vòng 2:** chia Worker song song, rút gọn ngữ cảnh, dùng Reviewer. Phần chia việc và tự thêm review
đã commit ở `bc109424d`; đã chạy thật ở §12.5 và §12.7. Con số 150–175 nghìn ở báo cáo vòng 2 là token cộng dồn qua
các lần model xử lý trong một lượt bot, không phải kích thước một prompt; `contextTokens` được phân biệt ở §12.7.

### 12.4 Thử cho workflow tự sửa repo (2026-11-11)

- Worktree `D:/OMB-trial/work/bot-management`, nhánh `trial/tester-before-work` (từ `bfebd4106`), `node_modules` nối sang
  repo chính. Đội: Lead `claude-sonnet-5-5`, Worker Codex `gpt-5.6-sol`, Tester Codex `gpt-5.6-terra`, Reviewer
  `claude-haiku-5-5`. `verify`: typecheck server, unit test goal-run, lint server. Script `D:\OMB-trial\drive-self.mjs`.
- Việc: trả lại lần đầu khi Lead giao Tester trước khi Worker làm (lấy từ §12.2), lần sau chấp nhận; kèm unit test.
- Kết quả: `blocked` ở lượt 2 sau 40 s — tài khoản ChatGPT của Codex hết hạn mức (reset 12/11/2026 17:04 giờ Việt Nam).
  App xử lý đúng: nhận ra hết lượt, không có Worker khác, dừng với lý do rõ. Worktree chưa bị sửa.
- Tính năng tự phục hồi (kế thừa) đã tự đặt lịch chạy tiếp lúc 17:05 ngày 12/11 trong database thử; chỉ chạy nếu server
  thử còn bật.

### 12.5 Chia việc song song với model thật (2026-11-11)

Chạy trên thay đổi chia việc song song (đã commit ở `bc109424d`: Lead bắt buộc lập plan cho Worker, chia module độc lập cho nhiều
Worker; server tự thêm task review sau task Worker; lượt goal bỏ brief công việc gần đây). Dự án `inventory-parallel`
(bản sạch của Inventory service). Đội: Lead `claude-opus-5-5`, Worker 1 `claude-sonnet-5-5`, Worker 2 Codex
`gpt-5.6-sol`, Tester Codex `gpt-5.6-terra`, Reviewer Codex `gpt-5.6-luna`; Codex qua engine `codexOrca2` (biến
`CODEX_HOME` trong `instances` của `config.json` trỏ tới tài khoản Orca 2 — đặt `CODEX_HOME` cho tiến trình server
không có tác dụng).

| | Lần trước (§12.3, 1 Worker làm) | Lần này (song song) |
|---|---|---|
| Kết quả | `completed`, 7/7 | `completed`, 7/7, Reviewer không có phát hiện, chỉ sửa `src/` |
| Lượt | 5 | **4** (Lead → sóng 2 Worker → sóng Tester + Reviewer → Lead) |
| Thời gian | 65 s | 86 s |
| Token | 352.321 | 555.426 (Lead Opus 179.629 / 2 lượt; Worker 1 138.417; Worker 2 65.016; Tester 64.808; Reviewer 107.556) |
| Plan bị trả | 0 | 0 |

- Thay đổi hoạt động đúng: Lead lập một plan chia việc cho cả 2 Worker, chạy cùng một sóng; Tester và Reviewer chạy cùng
  sóng sau; không cần lượt Lead ở giữa. Không còn dòng "recent-work brief".
- Ít lượt hơn nhưng tốn token hơn khoảng 58% và chậm hơn: thêm một vai (Reviewer) và một Worker, Lead Opus nạp nhiều
  ngữ cảnh hơn Sonnet. Với dự án nhỏ, song song chưa lợi về token; lợi ích kỳ vọng ở dự án nhiều module hơn.
- Lần chạy trước đó với cùng đội bị dừng tay ở lượt 1 (để lại 2 bot và một room cùng tên trong database thử).

### 12.6 Team mới tự sửa repo (2026-11-11)

- Nhánh `trial/self-fix-team2`, worktree `D:/OMB-trial/work/bm-team2`; commit nền `4fd18863e` = thay đổi chia việc song song
  (chưa commit ở `main`). Đội: Lead Opus 5.5, Worker 1 Sonnet 5.5, Worker 2 Codex `gpt-5.6-sol`, Tester Codex
  `gpt-5.6-terra`, Reviewer Codex `gpt-5.6-luna` (Codex qua `codexOrca2`). Script `D:\OMB-trial\drive-team2.mjs`.
- Việc: lần đầu Lead giao Tester/Reviewer trước khi có Worker làm thì trả lại, lần sau chấp nhận; kèm unit test.
- Kết quả: `completed` lượt 11/13, 763 s. Diff +79 test / +29 code, chỉ 2 file được phép, không commit. Kiểm lại độc lập:
  typecheck, lint sạch; 73/73 test (goal-run, team-roles, comment-history).
- Diễn biến: Lead chia theo file (Worker 1 code, Worker 2 test, phụ thuộc). Worker 1 viết luôn test (audit `writes` báo,
  không chặn) nên Worker 2 chỉ kiểm lại. Tester PASS; Reviewer bắt một comment trái `AGENTS.md` và thiếu test giới hạn 3
  lần trả → Lead tự mở vòng 2 (xoá comment, thêm test), rồi vòng 3 kiểm lại.
- Token: **3,53 triệu** (Reviewer 895 nghìn / 3 lượt; Worker 1 844 nghìn / 2; Worker 2 805 nghìn / 3; Tester 546 nghìn /
  3; Lead 437 nghìn / 4); chi phí engine báo $2,27 (phần Claude). Gấp khoảng 6 lần một dự án nhỏ: mỗi lượt trên repo
  lớn nạp 150–450 nghìn token.
- Bài học: (1) Worker lấn file của Worker khác vẫn xảy ra — cân nhắc cho audit `writes` của Worker cũng mở vòng sửa hoặc
  dặn rõ hơn; (2) chia "code" và "test" cho hai Worker có phụ thuộc là chia giả song song, tốn thêm một Worker mà không
  nhanh hơn; (3) Reviewer có ích thật (bắt lỗi quy ước mà test không bắt).

### 12.7 Inventory service với Sol 6.0, Terra 6.1 và Luna 6.0

- Cùng commit gốc `6566aad00ebe1b743981eae88168ec5399e54ba7`, cùng 7 test (ban đầu 2 qua, 5 lỗi), cùng goal và
  `verify = npm test`. Fixture riêng `D:/OMB-trial/optimized-inventory-20261111`, cổng 8941; không thay dữ liệu cũ.
- Đội: Lead `gpt-6-sol`; Worker `gpt-6.1-terra` và `gpt-6-luna`; Tester `claude-haiku-5-5`;
  Reviewer `gpt-5.6-sol`. Terra 6.1 được duyệt thay cho Terra 6.0 không có trong catalog.
- Lead chia orders/money cho Terra, inventory/report cho Luna ngay ở plan đầu; thời gian hai Worker chồng nhau.
  Tester và Reviewer cũng chạy đồng thời sau Worker. Reviewer bắt lỗi làm tròn tiền dù 7 test đều qua; Lead giao
  Terra sửa rồi kiểm lại cả Tester và Reviewer.

| Chỉ số | Vòng 2 (§12.3) | Lần này |
|---|---:|---:|
| Kết quả | completed, 7/7 | completed, 7/7, chỉ 4 file `src/` đổi |
| Lượt goal | 5/13 | 7/13 |
| Lượt bot trong usage ledger | 5 | 10 |
| Thời gian runner | 65 s | 203 s |
| Token input + output, không gồm setup | 352.321 | 903.484 |
| Worker được dùng | 1/2 | 2/2 |
| Lượt Reviewer | 0 | 2 |

Token theo vai: Lead 107.272 (3 lượt), Terra 298.246 (2), Luna 115.061 (1), Tester 193.796 (2), Reviewer 189.109 (2).
Setup riêng 4.597 token. Kiểm độc lập `npm test` qua 7/7, `git diff --check` sạch; test và package.json không đổi.

`contextTokens` ở lần model xử lý cuối của mỗi lượt: Terra 24.047–27.938, Luna 24.986, Tester 46.354–50.486;
vòng 2 Worker 24.525, Tester 44.168. Chưa thấy giảm ngữ cảnh Worker/Tester; tổng token tăng 156,4% do thêm vai,
thêm vòng sửa và thay model. Không thể quy riêng chênh lệch cho thay đổi code. Giá USD của các model 6.x chưa được
ghi nhận: tổng tiền của các dòng có giá không phải hoá đơn toàn run.

Bản tóm tắt có thể đối chiếu trong repo: [`docs/verification/evidence/inventory-live-comparison.json`](docs/verification/evidence/inventory-live-comparison.json).
Report và transcript đầy đủ giữ tại fixture; không đưa dữ liệu phiên vào git.

### 12.8 Hợp đồng vai với model thật, chỉ Claude + GPT (2026-11-11)

- Cùng Inventory service (§12.7): commit `6566aad`, 7 test (ban đầu 2 qua, 5 lỗi), cùng goal, `verify = npm test`.
  Fixture riêng `D:/OMB-trial/contract-inventory-20261111`, cổng 8951; code server có bước 0 của §13.6 (chưa commit).
- Đội: Lead `claude-opus-5-5`; Worker `gpt-6.1-terra` và `gpt-6-luna` cùng tài khoản GPT Plus 2 (`95b9…`); Tester
  `claude-haiku-5-5`; Reviewer `claude-sonnet-5-5`. GPT Plus 1 (`1dcd…`) đã dùng 100% tuần (reset 2026-11-12 10:04 UTC);
  `~/.codex` là tài khoản free. Grok và Antigravity chưa reset nên không dùng.
- Kết quả: completed, lượt 4/13, 73 s. Kiểm độc lập `npm test` 7/7, chỉ 4 file `src/` đổi, `git diff --check` sạch.
- Hợp đồng vai: Tester kết thúc `VERDICT: PASS`. Reviewer viết 5 dòng `FINDING` (1 `fix` làm tròn tiền giữa chừng,
  4 `note`) và `REVIEW: CLEAR`. Không có `block` nên không vòng sửa; Lead ghi lý do bỏ qua `fix`/`note`. Cùng lỗi làm tròn
  này ở §12.7 đã mở một vòng sửa.
- **Đã sửa sau lần chạy (bảng kế hoạch, §13.3):** Lead tự viết task Tester/Reviewer nên task review tự thêm (liệt kê file theo task) không được dùng; Reviewer tự đặt
  task id (`T-orders`), gắn chủ qua đường dẫn file vẫn được. Luna thấy file của Worker kia đổi trong thư mục chung (§13).

| Chỉ số | §12.7 | Lần này |
|---|---:|---:|
| Lượt goal | 7/13 | 4/13 |
| Lượt bot trong usage ledger | 10 | 6 |
| Thời gian runner | 203 s | 73 s |
| Token input + output | 903.484 | 566.717 |
| Lead | 107.272 (3, GPT Sol 6.0) | 134.940 (2, Opus 5.5) |
| Worker | 413.307 (3) | 199.684 (2) |
| Tester | 193.796 (2) | 93.869 (1) |
| Reviewer | 189.109 (2, GPT Sol 5.6) | 138.224 (1, Sonnet 5.5) |

Chênh lệch chủ yếu do không có vòng sửa (`fix` không chặn) và đổi model Lead/Reviewer; không quy được cho riêng hợp đồng vai.
Giá theo bảng giá API của phần Claude: $0,76 (Opus $0,547, Sonnet $0,203, Haiku $0,010); dòng GPT 6.x chưa có giá.

Quota (`GET /api/plan-usage`, số nguyên %):

| Tài khoản | 5 giờ trước → sau | Tuần trước → sau |
|---|---|---|
| Claude Pro | 36 → 43 | 62 → 62 |
| GPT Plus 2 | 0 → 0 | 48 → 48 |

- Engine Claude của fixture dùng chung tài khoản với phiên Claude Code đang điều khiển thử nghiệm (`CLAUDE_CONFIG_DIR` kế
  thừa). 73 giây sau khi goal xong, chỉ có phiên điều khiển chạy, cửa sổ 5 giờ vẫn tăng 43 → 45. Ước phần của run: khoảng
  6 điểm (5–7) cửa sổ 5 giờ Claude cho 367 nghìn token phía Claude, tức khoảng 15 run cỡ này mỗi cửa sổ khi bắt đầu từ 0%.
  Phần tuần dưới 1 điểm.
- GPT Plus 2: 200 nghìn token (phần lớn cached) không làm đổi số nguyên % nào: dưới 1 điểm mỗi cửa sổ.
- Đo sạch hơn: fixture dùng tài khoản Claude riêng, hoặc phiên điều khiển không gọi model trong lúc chạy.

### 12.9 Web bán hàng đầy đủ, bảng kế hoạch, Claude + GPT (2026-11-11)

- Bài: `D:/OMB-trial/shop-20261111/work/SPEC.md` — backend `node:http`, DB `node:sqlite`, frontend thuần trong `public/`,
  không phụ thuộc npm; auth, sản phẩm + lọc/sắp xếp/phân trang, giỏ, coupon, checkout (thuế, ship, trừ kho, giao dịch),
  vòng đời đơn + hoàn kho khi huỷ, review chỉ khi đã nhận hàng, thống kê admin, test riêng. Test nghiệm thu ẩn
  `acceptance.test.mjs` (10 nhóm) viết trước, đội không thấy. Fixture cổng 8961; code server có bảng kế hoạch (§13.3).
- Đội: Lead `gpt-6-sol`, Worker `gpt-6.1-terra` (backend) và `gpt-6-luna` (frontend) cùng GPT Plus 2; Tester
  `claude-haiku-5-5`; Reviewer `claude-sonnet-5-5`. Lead không dùng Opus vì cửa sổ 5 giờ Claude đã ở 56%.
- Kết quả: completed, lượt 7/13, 767 s. `npm test` của đội 75/75. Nghiệm thu ẩn 9/10; nhóm hỏng là `pageSize=500`:
  đội trả 400, test chờ kẹp về 50 — đặc tả chỉ ghi "max 50", lỗi ở đặc tả.
- Bảng kế hoạch tới đúng Tester và Reviewer cả hai plan (Lead tự viết task kiểm). Reviewer ghi đúng mã `t1`/`t2`:
  lần 1 `block t1` (chưa có test), `fix t2` (CSS rỗng, `onerror` nhúng chuỗi), `fix t1`…; lần 2 `REVIEW: CLEAR` và nêu lý do
  giữ từng phát hiện cũ. Tester lần 1 kết thúc `VERDICT: ` rỗng → server hỏi lại, không tính vòng sửa.
- Lỗi phát hiện:
  1. **Đã sửa (§14.5 bước 1).** Plan 1 giao Tester task "Test engineer" có `writes: tests/`: Tester tự viết 900 dòng test rồi tự chấm (trái §8.4).
     Plan check không chặn task Tester/Reviewer có `writes`. Lead tự sửa ở plan 2 (Worker t1 sở hữu test, Tester chỉ đọc)
     sau ghi chú audit và review.
  2. **Đã sửa (§14.5 bước 1).** `pathDeclared` (audit `writes`, `owningTask`) không khớp khai báo thư mục: `src/server.js` không thuộc `["src/"]`.
     Audit báo sai "terra, luna changed files outside their declared writes"; tra chủ theo file thất bại với task khai thư mục.
  3. Code nén: `src/server.js` 106 dòng, dòng dài nhất 1.629 ký tự (trung bình 196); `public/app.js` tương tự.
     Reviewer không nêu; đặc tả không có quy tắc định dạng.

| Vai | Token | Lượt | Ghi chú |
|---|---:|---:|---|
| Lead (Sol 6.0) | 95.398 | 3 | |
| Terra (backend) | 555.799 | 2 | |
| Luna (frontend) | 1.060.439 | 2 | |
| Tester (Haiku 5.5) | 1.192.758 | 2 | lần 1 viết test, output 48 nghìn |
| Reviewer (Sonnet 5.5) | 458.293 | 2 | |
| Tổng | 3.362.687 | 11 | cached input 2,95 triệu |

Quota (`/api/plan-usage`, trước 14:42:42 → sau 14:55:50 UTC):

| Tài khoản | 5 giờ | Tuần |
|---|---|---|
| Claude Pro | 56 → 65 | 64 → 65 |
| GPT Plus 2 | 0 → 4 | 48 → 49 |

- GPT Plus 2 gánh 1,71 triệu token (Lead + 2 Worker): 4 điểm cửa sổ 5 giờ, 1 điểm tuần.
- Claude 1,65 triệu token (Tester Haiku + Reviewer Sonnet): 9 điểm 5 giờ, nhưng phiên điều khiển có gọi model trong lúc
  chạy (ghép nối trình duyệt theo yêu cầu); ước phần của run 6–7 điểm.

### 12.10 Inventory service với branch riêng, giữ nguyên model (2026-11-12)

- Cùng commit `6566aad00ebe1b743981eae88168ec5399e54ba7`, đề bài và 7 test như §12.8; ban đầu 2 qua, 5 lỗi.
  Clone độc lập tại `D:/OMB-trial/branch-inventory-20261112-1794418584637/work`, database riêng và cổng 24291/24292.
  Chạy code hiện tại, `isolatedBranches = true`, `verify = npm test`; không dùng app/database/dự án đang chạy của người dùng.
- Giữ đúng đội §12.8: Lead `claude-opus-5-5`; Worker `gpt-6.1-terra`, `gpt-6-luna` trên GPT Plus 2;
  Tester `claude-haiku-5-5`; Reviewer `claude-sonnet-5-5`. Dùng lại đăng nhập CLI, không đổi model khi chạy.
- **Kết quả:** completed, 4/13 lượt goal, 6 lượt bot, 77 giây. Tester `VERDICT: PASS`; Reviewer `REVIEW: CLEAR`,
  3 `note`, không `block`/`fix`. Hai Worker chạy đồng thời 28,479 giây ở hai worktree khác nhau. Server ghép đúng thứ tự
  t1/t2, không conflict; Tester/Reviewer chạy ở integration. Chỉ bốn file `src/` đổi, ngoài `writes` = 0.
- **Kiểm độc lập:** integration `npm test` 7/7, `git diff --check` sạch, test và package.json không đổi.
  HEAD, hash index và `git status` repo gốc được so trong suốt goal, giữ nguyên; chạy test lại ở repo gốc vẫn 2 qua, 5 lỗi.
  Branch kết quả giữ `pending`, chưa merge vào repo gốc. Đã dừng đúng cây tiến trình server fixture, cổng được giải phóng;
  giữ worktree/data/báo cáo để đối chiếu, không sửa fixture cũ.

| Chỉ số | Không branch (§12.8) | Có branch |
|---|---:|---:|
| Test integration | 7/7 | 7/7 |
| Lượt goal / lượt bot | 4 / 6 | 4 / 6 |
| Thời gian runner | 73 s | 77 s |
| Token input + output, không setup | 566.717 | 625.224 |
| Lead | 134.940 | 138.995 |
| Terra | 88.995 | 160.486 |
| Luna | 110.689 | 88.795 |
| Tester | 93.869 | 142.166 |
| Reviewer | 138.224 | 94.782 |

- Tổng token tăng **10,32%**, thời gian tăng 4 giây; một lần chạy không chứng minh nguyên nhân hoặc tiết kiệm token.
  Cached input 435.780 đã nằm trong input; setup riêng 13.787 token. Dòng GPT 6.x vẫn không có giá trong ledger nên
  phần giá Claude $0,794 không phải hoá đơn toàn run.
- Quota số nguyên trước → sau: Claude 5 giờ 41 → 47%, tuần 75 → 75%; GPT Plus 2 5 giờ 95 → 97%, tuần 63 → 63%.
  Tài khoản dùng chung với phiên điều khiển/hoạt động khác, không quy toàn bộ chênh lệch cho fixture.
- **Giới hạn quan sát được:** Terra tự commit task dù được dặn server sẽ commit; audit/merge vẫn xử lý đúng.
  Reviewer tự chạy lại `npm test`, trùng việc Tester, dù hợp đồng vai đã dặn không lặp. Đây là chỉ dẫn mềm, chưa có chặn lệnh.
  Chưa gây conflict bằng model thật trong lần này; sửa conflict đã có kiểm thử tự động trên fixture riêng.
- Bằng chứng rút gọn: [`docs/verification/evidence/inventory-branches-live.json`](docs/verification/evidence/inventory-branches-live.json).
  Report, transcript, usage, plan trước/sau và source runner đầy đủ nằm trong fixture, không đưa dữ liệu phiên vào git.

## 13. Branch riêng cho từng Worker, hợp đồng vai, đội theo quota — thiết kế và triển khai

### 13.1 Vì sao
- Hiện mọi Worker sửa chung thư mục room; `writes` chỉ được **PHÁT HIỆN SAU** (§1.3). Worker lấn file của nhau vẫn
  xảy ra (§12.6 bài học 1); task trùng file phải chạy lần lượt.
- Mục tiêu: mỗi task Worker làm trong **git worktree riêng**; server merge; Tester/Reviewer kiểm bản đã ghép.
  Không nhằm giảm token: phải đo lại (§13.7).

### 13.2 Luồng
1. Goal bắt đầu: server tạo branch tích hợp `omb/<groupKey>/<runKey>/integration` từ HEAD của thư mục room.
2. Mỗi task Worker trong wave: `git worktree add` một branch `omb/<groupKey>/<runKey>/tasks/<sequence>-<taskKey>` tách từ đầu branch tích hợp.
   Lane thread của task ghim `pinnedCwd` = worktree đó (móc vào `taskThread`; `pinGroupCwd` đã ghim theo thread).
3. Worker xong: server tự commit trong worktree. Diff rỗng → không commit, ghi activity.
4. Audit `writes` đổi thành so diff `base..branch task` với `writes` đã khai: chính xác, không còn quy nhầm cho wave.
5. Hết wave: server merge các branch task vào branch tích hợp **theo thứ tự plan** (`--no-ff`).
   - Sạch → wave sau tách từ kết quả đã ghép (task phụ thuộc thấy code của wave trước).
   - Conflict → `merge --abort`, mở **task sửa conflict** cho Worker của task merge sau, trên worktree mới từ branch
     tích hợp, kèm diff của chính task đó. Lead không tự sửa, không tự merge.
6. Tester, Reviewer và `verify` chạy trên worktree của **branch tích hợp**.
7. Thư mục làm việc của người dùng không bị đụng trong lúc chạy. Kết thúc goal, card goal cho chọn: merge vào branch
   gốc (qua thẻ duyệt), giữ branch, hoặc bỏ. Không tự merge vào branch của người dùng.
   Goal dừng giữa chừng (blocked, hết 13 lượt, hủy) → giữ branch; gửi lại goal thì chạy tiếp từ branch tích hợp.

### 13.3 Hợp đồng từng vai
Áp cho cả chế độ chung thư mục hiện tại lẫn chế độ branch; chỗ khác nhau ghi trong ô. Hiện có: `VERDICT` của Tester
(`testerVerdict`, `server/team-roles.ts`). Reviewer mới chỉ được dặn "report findings by file and severity"
(`withReviewTask`), server chưa đọc được: phần dưới thêm định dạng có cấu trúc.

| Vai | Đầu vào | Khi nào chạy | Đầu ra | Không được |
|---|---|---|---|---|
| Lead | Goal, kết quả wave, báo cáo merge, `VERDICT`, phát hiện review | Mỗi lượt goal | Plan (task, `writes`, `dependsOn`), giao vòng sửa, báo hoàn thành | Nhận task, sửa code, tự merge |
| Worker | Task + `writes`. Có branch: worktree riêng tách từ branch tích hợp | Khi task tới lượt trong wave | File đã sửa + tóm tắt ngắn (đường dẫn, kết quả kiểm; không dán file) | Ghi ngoài `writes`; có branch: ghi ngoài worktree của mình |
| Tester | **Bảng kế hoạch** (bên dưới) + chung thư mục: thư mục room sau wave. Có branch: worktree của branch tích hợp đã merge | Một lượt sau mỗi wave có Worker (task tự thêm bởi `withTesterTask`), không theo từng task | Mỗi lỗi một dòng `FAIL: <file hoặc test> — <lỗi>`; dòng cuối `VERDICT: PASS` hoặc `VERDICT: FAIL` | Sửa file tracked → PASS vô hiệu (§8.4). Room có `verify` thì đọc kết quả server chạy, không tự chạy lại |
| Reviewer | **Bảng kế hoạch** (bên dưới) + thay đổi của wave chia theo task. Có branch: diff `base..task` của từng task. Chung thư mục: Reviewer đọc các file trong bảng (server chưa đính kèm diff) | Một lượt mỗi wave có Worker, song song với Tester. Thêm một lượt trên diff tổng trước khi Lead báo xong, nếu có thay đổi sau lần review trước | Mỗi phát hiện một dòng `FINDING: <block\|fix\|note> <taskId> <file>:<dòng> — <mô tả>`; dòng cuối `REVIEW: CLEAR` hoặc `REVIEW: BLOCK <số>` | Ghi file; lệnh ngoài mức Ask; chạy lại build/test của Tester |
| Server | — | — | Tạo/xoá worktree, commit, merge, chạy `verify`; gắn lỗi và phát hiện vào task và Worker sở hữu | Quyết nội dung |

Server xử lý đầu ra:
- `VERDICT: FAIL` → vòng sửa cho Worker sở hữu file trong các dòng `FAIL:` (có branch: tra diff từng branch;
  chung thư mục: tra `writes`). Không xác định được chủ → Lead chọn.
- `block` = sai hành vi, mất dữ liệu, lỗ hổng, vi phạm `AGENTS.md`; `fix` = nên sửa nhưng không sai yêu cầu;
  `note` = ghi chú. Chỉ `block` chặn hoàn thành.
- `REVIEW: BLOCK <số>` → Lead phải mở vòng sửa cho từng `block`, hoặc ghi lý do bỏ qua từng cái. Báo hoàn thành khi
  còn `block` chưa xử lý thì bị trả lại một lần, như luật gửi Tester/Reviewer sớm. `fix`/`note` để Lead cân nhắc.
- Thiếu dòng cuối (`VERDICT` hoặc `REVIEW`) → coi như chưa test hoặc chưa review, giao lại một lần.
- Hoàn thành khi: Tester PASS, mọi `verify` đạt, không còn `block` chưa xử lý (thêm điều kiện thứ ba vào cổng hiện có).

Vì sao một lượt Reviewer mỗi wave, không mỗi task: trên repo lớn mỗi lượt nạp 150–450 nghìn token (§12.6), review
theo task nhân số lượt theo số Worker. Diff chia theo task vẫn gắn được phát hiện vào đúng task.

**Bảng kế hoạch** (`workPlan`, `server/team-roles.ts`): mỗi task Worker của plan một dòng
`- <mã task> · <tên Worker> · <làm gì: câu giao việc, rút gọn 160 ký tự> · <file trong writes>`. Server gắn bảng vào
mọi task Tester và Reviewer của plan: task do server tự thêm, và cả task do Lead tự viết (giữ câu của Lead, nối bảng).
Lý do: §12.8 Lead tự viết task Reviewer, Reviewer không biết mã `t1`/`t2` nên tự đặt (`T-orders`).
Không cho Lead gửi kế hoạch cho Tester/Reviewer trước khi Worker làm: tốn thêm 2 lượt mỗi plan mà chưa có code để kiểm;
lượt kiểm trước Worker đã phí 2/13 lượt trong một lần chạy thật (`d50da44de`). Góp ý kế hoạch trước, nếu cần, là tính
năng riêng (công tắc theo room), chưa làm.

**Luồng một plan:**
1. Lead lập plan: task Worker có mã, người làm, câu giao việc, `writes`; có thể kèm task Tester/Reviewer tự viết.
2. Server kiểm plan (vai, `writes`, vendor, gửi kiểm trước Worker) như hiện có.
3. Server dựng bảng kế hoạch từ các task Worker.
4. Thiếu task Tester hoặc Reviewer → server thêm, chờ mọi task Worker; có sẵn → giữ, nối bảng. Cả hai đều mang bảng.
5. Wave Worker chạy song song; mỗi Worker chỉ thấy task của mình.
6. Tester và Reviewer chạy song song sau Worker, cùng bảng: Tester kiểm hành vi từng task giao (`FAIL:`, `VERDICT`);
   Reviewer đọc theo task (`FINDING` có mã task trong bảng, `REVIEW`).
7. Server gắn kết quả vào Worker: mã task của `FINDING` trước, không có thì theo file trong `writes`.
8. Lead nhận ghi chú có tên Worker: còn `block`/`FAIL` → plan sửa mới (task mới vào bảng, quay lại bước 3); hết → báo xong.
9. Hoàn thành khi Tester PASS, mọi `verify` đạt, không còn `block` chưa xử lý.

### 13.4 Phạm vi và công tắc
- Trường room mới `isolatedBranches` (bật/tắt trong room panel); chỉ chạy khi thư mục room là git repo.
  Không phải git hoặc room không có thư mục → giữ cách chung thư mục hiện tại.
- Worktree đặt ngoài repo: `<DATA_DIR>/worktrees/<groupKey>/<runKey>/integration` hoặc `<sequence>-<taskKey>`;
  key là hash ID, ledger giữ ID gốc. Xoá worktree sạch sau khi merge, branch giữ tới khi
  goal kết thúc.
- Không đổi schema DB: lane thread đã có `pinnedCwd`; bảng branch của run lưu trong file ledger ở `DATA_DIR`
  (như ledger research). Wire của card goal thêm thông tin branch.

### 13.5 Cái giá và rủi ro
- Mỗi worktree phải cài phụ thuộc: thêm lệnh `setup` theo room (cùng kiểu `verify`, server chạy). pnpm nhẹ, hệ khác
  có thể nặng.
- File bị ignore (`.env`, config cục bộ) không có trong worktree: thêm danh sách file cần copy theo room.
- Dev server và port có thể đụng nhau; đường dẫn dài trên Windows; submodule/LFS chưa hỗ trợ ở bản đầu.
- Conflict tốn thêm lượt và token; engine gắn phiên với thư mục nên mỗi worktree là một thread mới.

### 13.6 Thứ tự làm
0. **ĐÃ LÀM (2026-11-11, chưa commit)** — hợp đồng vai (§13.3) trên chế độ chung thư mục, không cần branch: định dạng `FAIL:`/`FINDING:`/`REVIEW:`, parser
   cạnh `testerVerdict`, cổng `block`, Tester và Reviewer nhận bảng kế hoạch (`workPlan`), giao lại khi thiếu dòng cuối. Unit + E2E fake engine.
   Đã có: `testerFailures`, `reviewReport`, `owningTask` (`server/team-roles.ts`; khớp đường dẫn dùng chung `pathDeclared` với audit
   `writes`); ghi chú cho Lead nêu Worker sở hữu từng dòng `FAIL:`/`FINDING`; `block` trả lại lần báo hoàn thành đầu, lần hai
   được nhận và ghi activity "set aside"; thiếu `VERDICT`/`REVIEW` → hỏi lại một lần, không tính vòng sửa.
   Chế độ branch đính kèm đường dẫn patch từng task cho Reviewer (2026-11-12).
1. **ĐÃ LÀM (2026-11-12, chưa commit)** — `server/goal-branches.ts`: tạo branch tích hợp + worktree riêng,
   commit từng task (bỏ qua diff rỗng), audit diff theo task, merge `--no-ff` theo thứ tự, gặp conflict thì abort sạch và
   dừng trước task kế. Task tiếp theo tách từ HEAD tích hợp hiện tại; ID task lặp được cấp sequence mới.
   Ledger `branches.json` nằm ngoài repo. Dọn chỉ worktree sạch thuộc đúng branch/repo, giữ file bẩn và bị ignore,
   giữ branch tới khi người dùng quyết định. Chỉ merge vào branch gốc sau xác nhận đúng HEAD; discard chỉ xoá tài nguyên của run.
   Khoá tuần tự thao tác Git; bỏ biến môi trường `GIT_*`, không chạy hook.
   Kiểm chứng bằng Git thật trên repo tạm: độc lập Worker, merge sạch/conflict, audit rename/ngoài writes, giữ nguyên
   HEAD/branch/index/file gốc, giữ dữ liệu chưa commit, từ chối repo bẩn/đường dẫn sai và hook không chạy.
   Đã restore ledger, giữ/merge sau restart; gửi lại đúng goal bị dừng để tiếp tục integration. File Worker chưa commit giữ riêng.
   Đặc tả/test: [`docs/verification/goal-branches.md`](docs/verification/goal-branches.md).
2. **ĐÃ LÀM** — nối `runGoalRun`, lane/cwd riêng theo task, sau công tắc `isolatedBranches`.
3. **ĐÃ LÀM** — audit `writes` và tìm chủ file theo diff đã merge; Tester, Reviewer, `verify` chạy ở integration.
4. **ĐÃ LÀM** — task sửa conflict cho đúng Worker, tối đa 2 lần rồi `needs-input`; lượt sửa tính vào ngân sách goal.
5. **ĐÃ LÀM** — card/panel có branch, kết quả merge và nút merge/giữ/bỏ; room panel có công tắc và file ignore cần copy.
6. **ĐÃ LÀM** — E2E fake engine: Worker song song, merge sạch/conflict, hai lần sửa thất bại, Tester FAIL → đúng Worker,
   Stop/tiếp tục, giữ/restart/merge, từ chối repo bẩn/HEAD đổi, discard giữ sửa đổi của người dùng. Browser thật kiểm công tắc
   và xác nhận/huỷ merge; các fixture dùng repo/home/data tạm, không dùng app thật.
7. **ĐÃ CHẠY (2026-11-12)** — Inventory với công tắc bật, giữ đúng model §12.8: completed 7/7, 4/13 lượt, 77 giây,
   625.224 token; repo gốc giữ nguyên. Số đo và giới hạn ở §12.10; chưa gây conflict bằng model thật.

### 13.7 Nghiệm thu
- E2E ở §13.6 bước 6 qua; thư mục làm việc của người dùng không đổi suốt goal (so `git status` trước/sau).
- Inventory service: completed, 7/7; so lượt, thời gian, token với §12.7 và ghi vào §12.
- Một bài cố tình gây conflict: đúng Worker nhận task sửa, goal vẫn hoàn thành.

### 13.8 Lựa chọn vận hành và phần còn cần quyết
Áp dụng các mặc định bảo toàn dữ liệu dưới đây khi hoàn thiện bước 5 theo yêu cầu ngày 2026-11-12; chưa bật cho room sẵn có.
1. Repo bẩn: từ chối và báo commit/stash trước, không tự commit file của người dùng.
2. Ngoài `writes`: cảnh báo theo diff, không tự mở vòng sửa.
3. Conflict: giới hạn riêng 2 lần rồi `needs-input`, vẫn tính chung ngân sách lượt goal.
4. Mặc định tắt; room research tắt (giữ luật §8.2).
5. Không tự merge vào branch gốc: owner/admin xác nhận trên card đúng HEAD, hoặc giữ/bỏ branch. Merge còn kiểm repo gốc sạch và chưa đổi HEAD.
6. **Đã chốt 2026-11-11: một lượt mỗi wave.** Reviewer: một lượt mỗi wave trên diff chia theo task (đề xuất, §13.3) hay một lượt mỗi task (phát hiện sớm hơn,
   tốn lượt gấp số Worker).
7. **Đã chốt 2026-11-11: server kiểm.** Định dạng `FINDING`/`REVIEW` do server kiểm (đề xuất: thiếu dòng cuối → giao lại một lần; `block` chặn hoàn thành)
   hay chỉ dặn trong prompt.
8. Đội ở §13.9: đồng ý chia vai và backup như bảng, hay đổi (ví dụ Claude làm Reviewer, Gemini làm Lead).

### 13.9 Đội theo quota (5 tài khoản hiện có, 2026-11-11)
Tài khoản: Claude Pro, 2 ChatGPT Plus, Grok gói thấp, Antigravity (gói Google AI). Không hãng nào công bố hạn mức
tuyệt đối; Claude, Codex và Antigravity tính theo cửa sổ 5 giờ + hạn mức tuần, Grok chỉ có hạn mức tuần (tra cứu
2026-11-11, phần lớn nguồn bên thứ ba). Gói Grok thấp nhất có thể là pool nhỏ nhất.
Token theo vai đã đo: dự án nhỏ (§12.7) Lead 107 nghìn, Worker 115–298 nghìn, Tester 194 nghìn, Reviewer 189 nghìn;
repo lớn (§12.6) Reviewer 895 nghìn, Worker 805–844 nghìn, Tester 546 nghìn, Lead 437 nghìn.

| Vai | Tài khoản | Backup AI | Lý do |
|---|---|---|---|
| Lead | Claude Pro, Opus 5.5 | Antigravity (Gemini) | Vai tốn ít nhất nhưng quyết chất lượng plan; Opus làm Lead đã chạy tốt (§12.6) |
| Worker 1 | ChatGPT Plus #1, Codex | — | Vai tốn nhiều nhất; Codex làm Worker đã chạy tốt (§12.5, §12.7) |
| Worker 2 | ChatGPT Plus #2, Codex | — | Hai cửa sổ 5 giờ độc lập; một bên hết lượt thì Lead giao task cho bên kia (README, "Out of AI usage") |
| Tester | Grok | Antigravity (Gemini) | Room đặt `verify` để server chạy test; Tester chỉ đọc kết quả và báo `VERDICT`, nên tốn ít |
| Reviewer | Antigravity, **model Gemini** | Grok | Khác vendor với Worker (openai). Chọn model Claude trong Antigravity thì vendor là anthropic (`modelVendor`) |

- Backup AI dùng chung pool với vai khác (Antigravity vừa là Reviewer vừa là backup của Lead và Tester): theo dõi khi
  chạy goal dài. Backup đổi vendor → kiểm lại luật vendor (§8.5); Grok (xai) và Gemini (google) đều khác openai.
- Grok và Antigravity chưa chạy trong các lần thử thật ở §12. Tester thiếu `VERDICT` hoặc Reviewer không theo định
  dạng `FINDING`/`REVIEW` (§13.3) → đổi vai Tester và Reviewer cho nhau.
- Đo quota thật: chạy Inventory service (§12.7) với đội này; ghi % đã dùng trên dashboard từng tài khoản trước và sau,
  ghép với token theo vai trong usage ledger → số goal mỗi 5 giờ và mỗi tuần của từng tài khoản; ghi vào §12.

## 14. Quy tắc theo lớp, dự án có sẵn, conflict real-time, bàn trước rồi `/goal` — kế hoạch (2026-11-11, chưa code)

### 14.1 Quy tắc nào đặt ở lớp nào
| Lớp | Dùng cho | Mức |
|---|---|---|
| Server (code + `verify`) | Việc không được sai, không tin bot tự giữ | CỨNG |
| Chỉ dẫn dự án (`AGENTS.md` trong repo, chỉ dẫn room) | Quy ước riêng từng dự án: phong cách code, lệnh build/test, vùng cấm | MỀM; CỨNG khi có lệnh `verify` kiểm |
| Skill/playbook | Cách làm lặp lại ở nhiều dự án: checklist review, viết test, viết đặc tả | MỀM; tối đa 3 playbook mỗi việc theo từ khoá, không cấp quyền hay công cụ (`installed-playbooks.ts`) |
| MCP | Năng lực/dữ liệu bot không tự có: trình duyệt, sơ đồ code, issue tracker | Công cụ, không phải luật |

Áp vào §12.9: Tester/Reviewer có `writes` → server từ chối trong plan check; khai thư mục → sửa `pathDeclared`; code nén →
chỉ dẫn dự án + lệnh `verify` kiểm độ dài dòng/lint + mục "dễ đọc" trong skill review; không ai thử UI → MCP trình duyệt +
skill kiểm thử UI; đặc tả mơ hồ → skill viết đặc tả, Lead hỏi lại thay vì đoán.

### 14.2 Làm tiếp dự án lớn có sẵn
1. Hồ sơ dự án theo room: quy ước (`AGENTS.md`/`CLAUDE.md`), lệnh build/test/lint, sơ đồ module, vùng cấm (sinh tự động,
   vendor, migration), lệnh `setup`. Mục đích: bớt phần mỗi lượt tự khám phá repo (150–450 nghìn token/lượt, §12.6).
2. Trạng thái gốc: server chạy `verify` trước goal, ghi test vốn đã hỏng để Tester không quy cho Worker
   (`server/runtime-coordinator.test.ts` từng hỏng sẵn trên `HEAD`: expected thiếu `level: "ask"`; đã sửa assertion theo
   hợp đồng projection hiện tại khi kiểm chứng bước 4 ngày 2026-11-11).
3. Phạm vi goal: tiêu chí nghiệm thu, vùng được sửa, vùng cấm.
4. Kiểm hai tầng: mỗi vòng test vùng liên quan; bộ đầy đủ một lần trước khi hoàn thành.
5. Chế độ branch (§13) cho dự án có sẵn.

### 14.3 Conflict trong lúc làm: server theo dõi, Lead đánh giá
Không bot nào theo dõi real-time được: Lead chỉ chạy giữa các lượt. Server theo dõi (luôn chạy, không tốn token).
- Phát hiện: trong lúc wave chạy, server quét thư mục làm việc vài giây một lần (`git status` + hash như audit `writes`)
  và gắn thay đổi với lane/bot qua lệnh sửa file engine báo về.
- **Đã chốt 2026-11-11** — hai Worker sửa cùng file: server (1) gửi tin vào lượt đang chạy của Worker đến sau: "file X
  đang do <task>/<Worker> sửa, đừng sửa, báo lại Lead"; (2) ghi conflict cho Lead (file, hai task, ai sửa trước) để Lead
  đánh giá ở lượt kế: giao một người gộp, đổi plan, hoặc hỏi người dùng.
- Thay đổi không thuộc bot nào (người dùng sửa repo) → cảnh báo Lead và người dùng; ở chế độ branch không ảnh hưởng.
- Merge conflict (§13) → task sửa conflict cho đúng Worker; bất đồng Reviewer/Worker và FAIL lặp → luật hiện có
  (3 vòng sửa, `block` trả lại một lần), hết thì thẻ hỏi người dùng.
- Hiện real-time: Văn phòng (đường nối đỏ, dấu conflict), dòng activity trong room, "Cần bạn" khi cần người dùng quyết.

### 14.4 Bàn với Lead trước rồi mới `/goal`
Hiện có (đọc code 2026-11-11):
- Lượt goal của Lead chạy trong thread room, cùng bộ dựng prompt với lượt chat: thấy **30 tin gần nhất** của room
  (`GROUP_CONTEXT_MESSAGES`, `server/host/room-transcript.ts`) và phiên engine của chính Lead trong thread đó.
  Bàn bằng `/chat` rồi gửi `/goal` thì Lead thấy cuộc trao đổi nếu còn trong 30 tin.
- Room có Lead tự biến tin "giao việc" thành goal; muốn chỉ bàn thì mở đầu tin bằng `/chat`.
- Rủi ro: goal chạy thêm tin vào room, cuộc trao đổi trôi khỏi cửa sổ 30 tin; câu `/goal` là thứ duy nhất được lưu trên
  card. Worker/Tester/Reviewer chạy trong lane riêng, không thấy cuộc trao đổi, chỉ thấy task Lead viết.

Đề xuất "goal brief":
1. Người dùng bàn với Lead bằng `/chat`, rồi gửi `/goal` (có thể kèm câu ngắn: "làm theo những gì vừa chốt").
2. Lượt goal đầu tiên, Lead viết **goal brief** trong chính câu trả lời lập plan (không thêm lượt): mục tiêu, phạm vi
   làm/không làm, tiêu chí nghiệm thu, ràng buộc, câu hỏi còn mở.
3. Server lưu brief trên goal run (hiện trên card). Còn câu hỏi mở → `needs-input`, chờ người dùng trả lời.
4. Mọi lượt Lead sau nhận brief, không phụ thuộc cửa sổ 30 tin. Tester và Reviewer nhận tiêu chí nghiệm thu kèm bảng kế
   hoạch (§13.3) để kiểm theo đúng điều đã chốt.
5. Room research giữ file goal đã khoá (§8.2); brief không thay file goal.

### 14.5 Thứ tự
1. **ĐÃ LÀM (2026-11-11, chưa commit)** — sửa server: chặn Tester/Reviewer có `writes` (`teamPlanProblem`); `pathDeclared`
   hiểu thư mục (`src/`, `tests` khớp file bên trong, không khớp `srcs/`; khai rỗng `./` bị bỏ qua). Unit + test goal loop.
2. **ĐÃ LÀM phía server (2026-11-11, chưa commit)** — goal brief (§14.4): trường `brief` trong envelope plan đầu
   (`parseGoalBrief`, kiểu `GoalBrief` ở `shared/group-goal-run.ts`); chỉ room có vai + chia task; plan đầu thiếu brief
   bị trả lại một lần rồi chạy tiếp; `openQuestions` → `needs-input`; brief lưu trên card (`goalRun.brief`,
   `goal-cards.ts`), mọi lượt Lead sau nhận brief, Tester/Reviewer nhận `acceptance` kèm bảng kế hoạch. Unit + E2E fake
   engine. **Chưa có UI** hiện brief trên card/panel goal: để người dùng định nghĩa trong Neon (`GoalRunCard`/`GoalRunPanel`).
3. **ĐÃ LÀM phía server (2026-11-11, chưa commit)** — theo dõi conflict trong lúc wave chạy (§14.3), `watchWaveConflicts`
   (`server/goal-conflicts.ts`): mỗi 5 giây (và một lần sau khi wave xong) lấy file đổi từ đầu wave, gắn với Worker qua lệnh
   sửa file trong event log của lane (`editedPaths`, `server/edit-events.ts`: Claude `Write`/`Edit`/`MultiEdit`, Codex
   `edit`). Worker sửa file thuộc `writes` task khác, hoặc hai Worker cùng sửa file chưa ai khai → gửi tin vào lượt đang chạy
   của Worker sau (engine nhận được tin giữa lượt: Claude, Codex; Grok, Antigravity, OpenCode, ZCode, ACP thì không), ghi
   dòng activity ngay, lưu trên card (`goalRun.conflicts`, tối đa 20), hết wave ghi chú cho Lead đánh giá. Unit test.
   Giới hạn: file ghi bằng lệnh shell (Codex trên Windows hay dùng PowerShell — ở §12.9 `src/server.js`, `styles.css`) không
   gắn được Worker, chỉ audit `writes` sau wave thấy. **Chưa có UI** trên Văn phòng: dữ liệu `goalRun.conflicts`
   `{ file, ownerTask, ownerBotId, ownerName, otherTask, otherBotId, otherName, steered, at }` để người dùng định nghĩa trong Neon.
4. **ĐÃ LÀM phía server (2026-11-11, chưa commit)** — hồ sơ dự án + trạng thái gốc (§14.2): room `projectProfile`
   qua API (`instructions`, `moduleMap`, `protectedPaths`, `setup`); lưu trong `groups.json`, `null` xoá hồ sơ.
   Room có hồ sơ chạy setup rồi `verify` trước lượt bot đầu, không tốn lượt AI; setup lỗi → `blocked`, verify lỗi vẫn
   cho Lead lập kế hoạch sửa. Kết quả gốc lưu trên card (`goalRun.baseline`: thời gian, setup/checks, mã thoát thực,
   mã mong đợi, output đã che bí mật tối đa 1.000 ký tự), giữ qua tiến độ và kết thúc; mọi lượt Lead và task Worker,
   Tester, Reviewer nhận hồ sơ + baseline. Cổng verify cuối không bỏ qua lỗi có sẵn. Stop huỷ cả cây tiến trình lệnh.
   Không có hồ sơ → verify chỉ chạy cuối như trước. Chưa cấu hình verify → ghi rõ baseline chưa kiểm chứng.
   `protectedPaths` là chỉ dẫn MỀM, chưa sandbox; chỉ dẫn repo là tham chiếu, không tự đọc file; chưa tự khám phá lệnh,
   chưa có UI hồ sơ/baseline, chưa tách lệnh test liên quan mỗi vòng với bộ đầy đủ cuối goal.
   Cách cấu hình và fixture cách ly: [`docs/verification/room-project.md`](docs/verification/room-project.md).
   Kiểm chứng: bộ hồi quy 16 file — 359 test qua, 1 bỏ qua; sau tách module và sửa phục hồi thư mục, các test liên quan
   chạy lại đều qua. `room-coordination.e2e` 33/33, `runtime-coordinator` 109/109; typecheck, lint và kiểm tài liệu sạch.
   Guard độ dài file còn báo `server/index.ts`, `shared/wire.ts`, `src/components/GroupView.tsx` — cả ba đã vượt ngưỡng
   trên HEAD; không nâng giới hạn. `group-goal-run.ts` đã tách brief/conflict, còn 994 dòng.
5. **ĐÃ LÀM (2026-11-12, chưa commit)** — chế độ branch (§13): nối đầy đủ Git, vòng goal, lane/cwd, cổng kiểm,
   task sửa conflict, restore và UI merge/giữ/bỏ. Mặc định tắt, không sửa repo gốc trước khi người dùng xác nhận merge.
   Setup chạy trong từng worktree; chỉ copy file ignore được khai báo, từ chối symlink/submodule/LFS. Engine idle của lane
   được giải phóng trước khi dọn worktree trên Windows; không giết phiên đang làm hoặc process chia sẻ để dọn folder.
   Đã qua fixture API và browser riêng; bài Inventory với model thật đã chạy ở §12.10, completed 7/7.
   Kiểm chứng cuối: 184 test chức năng/hồi quy qua; 24 test route + ACP qua; 31 test CLI/card/cài đặt qua (1 test parallel room
   bị bỏ qua theo điều kiện suite); 7 test tài liệu qua. Loop 85 test và E2E branch chạy lại sau khi sửa tìm chủ file đều qua;
   E2E chạy lại lần cuối kiểm retry merge sau restart cũng qua. Hai test Claude giải phóng phiên idle qua.
   Browser 1366/390px: không tràn ngang, huỷ không đổi repo, xác nhận merge đổi đúng file, console không có error.
   `pnpm build` (gồm typecheck) và lint qua. Guard độ dài file vẫn báo đúng ba file đã vượt ngưỡng trên HEAD:
   `server/index.ts`, `shared/wire.ts`, `src/components/GroupView.tsx`; không nâng ngưỡng. Bằng chứng browser tại
   `.omb-scratch/verify-evidence/goal-branches/`; recipe và giới hạn tại `docs/verification/goal-branches.md`.
6. Skill (review, viết test, nhận dự án có sẵn, viết đặc tả) và MCP (trình duyệt; tuỳ chọn sơ đồ code).

### 14.6 Cần quyết
1. **Đã chốt 2026-11-11:** chỉ dừng khi brief có câu hỏi mở; không thêm bước duyệt.
2. **Đã chốt 2026-11-11:** không đổi UI. `/goal` trong ô nhập chỉ chuyển chế độ, vẫn cần chữ; gõ ngắn ("làm theo những gì vừa
   chốt") là đủ, brief của Lead giữ phần đã bàn.
3. Skill/MCP: dùng playbook có sẵn trong app, hay người dùng tự thêm MCP (ví dụ trình duyệt)?
