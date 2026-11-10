# NOTE: việc còn mở, để định nghĩa sau

Ghi ngày 2026-11-10. Đường dẫn và số dòng lấy từ lúc khảo sát; xác minh lại trước khi dựa vào.
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
  khi OFF; Chief lift vẫn nâng bot Ask khi ON. README "Reviewers read only" đúng sau khi bật flag (B13 còn đợi).

### 1.2 Repo có file không nên commit (commit `0b987b228` "d", chưa push)
- `..dist/` (278 file build, ~25 MB) và `test-server-data/` (29 file: `bots.json`, `messages.db`, `runtime.db`,
  `sessions.json.open`… dữ liệu chạy thử; chưa kiểm chứng có chứa tin nhắn hay phiên đăng nhập thật không).
- `main` đang đi trước `origin/main`; chưa push nên còn gỡ sạch khỏi lịch sử được.
- Chờ quyết: (1) `git rm --cached` + `.gitignore`; (2) viết lại commit `d`; (3) xoá `..dist/` trên máy.
- `pnpm lint` (lint cả `.`) đang fail vì `..dist/`; lint mã nguồn (`src server shared scripts electron`) sạch.

## 2. Việc dở dang

- **Stash `stash@{0}`** "WIP: room now waiting + Open to review": `/now` trả cờ "đang chờ duyệt", Team status
  có nút "Mở để duyệt" mở thẳng lane. Chưa type-check, chưa test. Lấy lại: `git stash pop`.
- **UI còn thiếu** (đã đánh giá, chưa làm):
  1. Bảng kế hoạch trong panel goal (task, người làm, trạng thái, phụ thuộc).
  2. Hiện cổng Tester trên card goal ("Tester: FAIL · vòng sửa 1/3").
  3. Nhãn "Đã chạy như goal · Đổi thành chat" trên tin tự chạy goal.
  4. Team status hiện "hết lượt dùng" và giờ reset.
  5. Huy hiệu vai trong khung chat; kiểm tra màn hình hẹp.
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
| B0(i) trần quyền theo vai | Có | CỨNG | Vừa | Áp ở dispatch (`:8468-8469`) **và** tự duyệt hộ (`:9634`). Có danh sách lệnh đọc/test được phép (cơ chế allowlist sẵn có, `docs/verification/command-allowlist.md`). |
| B0(ii) PASS cần bằng chứng | Có | CỨNG (cho việc tính PASS) | Vừa | Khớp lệnh `doneWhen` với `item.started`/`item.completed ok`. Bù hạn chế: lệnh chấm điểm tự ghi file kết quả kèm mã thoát. |
| B0(iii) file ngoài `writes` | Có | PHÁT HIỆN SAU | Vừa | Hash trước/sau mỗi đợt, hoặc `git status` nếu là repo git. Song song chỉ quy cho cả đợt; thư mục riêng mỗi lane (git worktree) tốn công gộp. |
| B0(iv) vùng ghi Tester | Có | PHÁT HIỆN SAU + trần `edits` | Nhỏ | Dùng lại (iii). |
| B1 kind code/research | Có | CỨNG | Nhỏ | Trường mới trong `WireGroup`. |
| B2 file goal (zod) | Có | CỨNG (định dạng, khoá hash khi duyệt) | Vừa | |
| B3 Evaluator + tập khoá | Có | PHÁT HIỆN SAU (quét log tìm đường dẫn) | Vừa | Chặn cứng tự nhiên nếu tập khoá nằm trên máy GPU. |
| B4 ràng buộc vendor | Có | CỨNG (trả kế hoạch) | Nhỏ | Kiểm lại khi đổi engine do hết quota; không đạt thì `blocked`. |
| B5 locks | Đã có | CỨNG trong một goal | — | Khoá xuyên room chỉ cần khi nhiều room dùng chung máy GPU. |
| B6 pilot gate | Có | CỨNG (plan check) | Nhỏ | |
| B7 ledger + guard ngân sách | Có | CỨNG nếu server tự chạy guard | Vừa | |
| B8 duyệt kế hoạch lần đầu | Có | CỨNG | Nhỏ | Dùng trạng thái `needs-input` sẵn có. |
| B9 hook `/research` | Có | — | Vừa | Bảng lệnh; sửa bốn chỗ ở A4. |
| B10 provenance | Có, phần lớn ngoài app | B (script/validator) | Lớn | Manifest + script chấm điểm Python trên máy GPU; validator so số trong báo cáo với file nguồn. |
| B11 bàn giao GPU | Có | CỨNG (`needs-input`, chờ file) | Vừa | |
| B12 rà mục "Xong" | Có | — | Nhỏ | Xem mục 4. |
| B13 sửa README | Có | — | Nhỏ | Xem mục 5. |

### 3.3 Còn trống, sẽ định nghĩa sau
- Hành vi cụ thể của `/research`.
- Đường truyền kết quả từ máy GPU về (copy tay / git / Drive).
- Viết đầy đủ Phần B theo mẫu (mức, loại luật, điểm gắn, test, phương án loại) trước khi làm Phần C.

### 3.4 Thứ tự đề xuất (rẻ và an toàn trước)
1. ~~B0(i) — sửa luôn lỗi mục 1.1~~ **xong** (`c65af79db`).
2. ~~B12–B13~~ **xong** (2026-11-10); kèm **B1** xong: `WireGroup.kind` ("code" | "research"), PATCH `/api/groups/:id`, e2e `room-kind`.
3. B0(ii)–(iv), B4.
4. B2, B8, B11, B7, rồi B3, B6, B9.
5. B10 song song (phần lớn ở phía máy GPU).

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
