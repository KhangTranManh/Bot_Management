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
| B1 kind code/research | **Xong** (`2efcebda2`, e2e `room-kind`) | CỨNG | Nhỏ | Chưa có gì đọc nó — các luật §8.2 nối dần. |
| B2 file goal (zod) | **Xong** (research-goal.ts: schema §8.8 + loadResearchGoal + sha256; room /; duyệt qua PATCH ) | CỨNG (định dạng, khoá hash khi duyệt) | Vừa | Chỉ áp room  (§8.2); room khác không đổi. |
| B3 Evaluator + tập khoá | **Xong phần quét** (goal file `heldOutPaths`; `scanHeldOut` đọc event log mỗi turn member, activity row PHÁT HIỆN SAU; role `evaluator` mới) | PHÁT HIỆN SAU | Vừa | Chỉ chống T1; T2 cần tách vật lý máy GPU (§8.1). Tập khoá thật nằm trên máy GPU (B10). |
| B4 ràng buộc vendor | **Xong một phần** (`model-vendor.ts` + `teamVendorProblem`) | CỨNG (trả kế hoạch) | Nhỏ | **Chỉ room `kind = "research"`** (§8.2). Vendor = công ty làm model, đọc từ họ model (`claude-…`, `gpt-…`, `glm-…`) rồi tới tiền tố provider; engine đa vendor (ZCode, Copilot, Cursor, Antigravity, Groq…) không tự là vendor; `unknown` bị trả. **Còn thiếu:** chỉ so Reviewer với Worker *trong cùng một kế hoạch* (Reviewer giao ở lượt sau thì không so); Tester chưa bị kiểm; backup AI (`bot.fallback`) không được đọc. |
| B5 locks | Đã có | CỨNG trong một goal | — | Khoá xuyên room chỉ cần khi nhiều room dùng chung máy GPU. |
| B6 pilot gate | **Xong** (goal file `pilot.maxTasks`; plan đầu của run research vượt → refused như plan check) | CỨNG (plan check) | Nhỏ | |
| B7 ledger + guard ngân sách | **Guard xong** (researchBudgetExceeded, dep , quá hạn → blocked; kết quả âm tính vẫn hợp lệ); ledger còn chờ đặc tả §6 | CỨNG nếu server tự chạy guard | Vừa | Guard wall-minutes đã chạy; định dạng ledger do đặc tả workflow chốt (§6.4). |
| B8 duyệt kế hoạch lần đầu | Có | CỨNG | Nhỏ | Dùng trạng thái `needs-input` sẵn có. |
| B9 hook `/research` | **Xong** (`researchTextFromComposer` + candidate Composer khi room `kind=research`; gửi vào goal mode — gate goal file chấm phần còn lại) | — | Vừa | Hành vi sâu hơn của `/research` đợi đặc tả §6. |
| B10 provenance | Có, phần lớn ngoài app | B (script/validator) | Lớn | Manifest + script chấm điểm Python trên máy GPU; validator so số trong báo cáo với file nguồn. |
| B11 bàn giao GPU | **Xong** (goal file `handoff.expectsFiles`; completed khi thiếu file → `needs-input` nêu tên file, đặt file xong gửi lại goal) | CỨNG (`needs-input`, chờ file) | Vừa | |
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
5. Kế tiếp: chạy thử Tầng 1 (§6.2 điểm 8) trên `D:\AGI` trước, rồi B2, B8, B11, B7, B3, B6, B9 theo cái thật sự hỏng.
6. B10 song song (phần lớn ở phía máy GPU).

B0(i) và B1 code trước khi chốt đặc tả §6 là ngoại lệ có chủ đích: dùng chung cho room code, không phụ thuộc
workflow nghiên cứu. Từ mục 4 trở đi chỉ code theo đặc tả đã chốt.

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
`kind` hiện chưa được đọc ở đâu. Đề xuất: mỗi luật dưới đây là một điều kiện **bắt buộc** khi `kind = "research"`;
thiếu thì goal không bắt đầu (trả `needs-input` kèm lý do), không âm thầm chạy mềm.

| Luật | Mục B | Ghi chú |
|---|---|---|
| Trần quyền theo vai luôn bật, bất kể `OMB_ROLE_CEILING` | B0(i) | Room research không được phép chạy ở chế độ cờ OFF |
| Không có Chief of Staff phía trên chuỗi giao việc | A1 | Chief nâng quyền (bảng A1) |
| Có file goal hợp lệ và đã khoá hash | B2, B8 | Lượt đầu luôn dừng chờ bạn duyệt |
| Lệnh kiểm tra lấy từ file goal, không từ Lead | B0(ii), §8.3 | |
| Evaluator/Reviewer khác nhà cung cấp model với Worker | B4, §8.5 | |
| Song song tắt, trừ khi có B0(iii) | §1.3 | |
| Ledger + guard ngân sách bật | B7 | |

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

Tất cả chạy trên engine giả, fixture cách ly theo `docs/verification/README.md`; chưa kiểm với model thật.

| Mục | Commit | Nội dung | Test |
|---|---|---|---|
| B0(i) trần quyền theo vai | `c65af79db` | `HandoffView.level` + `approvalModeUnderCeiling` (chỉ hạ, custom giữ mức riêng, đi xuống mức engine chạy được); gắn 4 chỗ; flag `OMB_ROLE_CEILING=1`, tắt = như cũ | Unit bảng cap; e2e `role-ceiling` 3/3: consult bot `full` → `default` khi ON / `bypassPermissions` khi OFF; Chief lift vẫn nâng khi ON |
| B12–B13 | `2efcebda2` | README: "Reviewers read only" ghi đúng cơ chế; Stop dừng cả cây; mục **Known limitations** | — |
| B1 room `kind` | `2efcebda2` | `WireGroup.kind` ("code" \| "research"), PATCH `/api/groups/:id`, null clear, giá trị lạ → 400; chưa có gì đọc | e2e `room-kind`: round-trip + từ chối |
| Gỡ file lạ | `222785ec0` | `..dist/` + `test-server-data/` khỏi tracking, ignore (blob vẫn còn trong lịch sử đã push) | — |
| B0(iii) audit `writes` | `35d5f0f23` | `writes-audit.ts`: `gitStatusPorcelain` + `writesOutside` (thuần, xử lý rename); chạy quanh mỗi batch wave; activity row `ok:false` | Unit 6/6 (gồm git thật trên Windows); e2e `writes-audit` POSIX-gated (worker Bash thật ghi stray) — chạy trên CI Linux, Windows skip |
| B0(ii) `verify` | `e3e6ca38b` | `WireGroup.verify` (`{id, command, cwd?, timeoutSec?, expectExit?}`, tối đa 8, cwd chỉ subfolder tương đối); PATCH lưu; **server tự chạy** (`execFile shell`, cwd = thư mục room) sau khi Tester PASS; PASS cuối = `VERDICT: PASS` ∧ mọi verify đúng exit; lệch → vòng sửa (cap 3 → `blocked`) | Unit: fail → fix round (`needs-input` kèm note); pass → completed; 4 lần fail → `blocked` "kept failing after 3 fix rounds"; e2e `verify-gate` POSIX-gated (artifact `verify-ran.txt` do server ghi trong workspace là bằng chứng) |
| B0(iv) vùng ghi Tester | `e3e6ca38b` | Audit quanh turn Tester (batch và single): Tester PASS nhưng ghi ngoài vùng báo cáo (task Tester khai `writes`) → **PASS void** + `team.untested = true` + vòng sửa | Unit: void → completed bị chặn (early-completion guard) kèm note "its PASS does not count"; writes trong vùng → PASS giữ nguyên |
| B4 vendor | `e3e6ca38b` | `model-vendor.ts`: bảng driver→vendor + parse `provider/model` (và `provider\model` của ZCode); `teamVendorProblem` trong plan check: Reviewer ≠ vendor mọi Worker trong plan; `unknown` → trả kế hoạch (không đoán); re-check tự nhiên qua `vendorOf` đọc bot live mỗi lần duyệt plan | Unit: cùng vendor → `blocked` "same model vendor"; khác vendor → completed; unknown → `blocked` "unknown model vendor"; `claudeAgent` có model id lạ vẫn `anthropic` |

| Sửa sau đánh giá | (chưa commit) | Audit hash nội dung file bẩn + `-uall` (bắt Tester sửa file Worker vừa sửa; file trong thư mục mới; sửa lỗi bản ghi `A` nuốt bản ghi kế tiếp); `verify` tách ra `verify-run.ts`, timeout kill cả cây tiến trình (Windows để lại tiến trình con chạy tiếp), room không folder → `blocked` trước lượt đầu; `modelVendor` đọc họ model; luật vendor chỉ cho room research; bỏ tham chiếu NOTE/tên mảnh trong comment | Unit 6 file **87/87** (gồm git thật và shell thật trên Windows); e2e goal + quyền **27/27**, 2 file POSIX-gated skip; typecheck + lint sạch |

**Kết quả test 2026-11-11:** unit 9 file liên quan — **109/109 qua**; e2e regression goal + quyền (`group-goal-run`, `group-goal-wait-cap`, `role-ceiling`, `room-kind`) — **27/27 qua**; typecheck `tsconfig.server.json` sạch. E2E POSIX-gated (`writes-audit`, `verify-gate`) skip trên Windows cục bộ, chờ CI Linux chạy thật.

**Còn mở:** B2, B8, B11, B7 → B3, B6, B9 (theo §3.4); §8.6 (hai goal cùng room); 6 điểm §6.4 (spec workflow); trần `edits` cho Tester là cấu hình mức bot (§6.2 điểm 5).
Phần thiếu của mục đã làm (chỉ cần cho room research): file được bảo vệ của `verify` (T2); luật vendor xuyên cả goal run và cho Tester; vùng báo cáo Tester ở đường đơn.
E2E `writes-audit`, `verify-gate` chỉ chạy trên POSIX; chưa có bằng chứng CI đã chạy chúng.
`scripts/testing/file-size-ratchet.test.ts` đang fail từ trước: `server/index.ts` (16.062 dòng, mốc 15.630), `shared/wire.ts` (1.026 > 1.000), `src/components/GroupView.tsx` (1.244, mốc 1.220).

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
| B7 ledger | goal file `ledgerFile` (mặc định `ledger.jsonl`, mode 0600): server tự append `run-start` / `verify` (mỗi lệnh, kèm exit thật) / `run-end` — bot không ghi/sửa được | e2e research-gate: verify-ran.txt + ledger do server ghi (chạy CI Linux) |
| B9 `/research` | `researchTextFromComposer` + candidate chỉ hiện ở room `kind=research`; gửi vào goal mode, gate goal file lo phần còn lại; locale `composer.command.researchDesc` | client tests 28/28 |
| Role Evaluator | `TEAM_ROLES` thêm `evaluator`; `teamRoleRule` (chỉ chạy evaluation script của goal file, trích kết quả theo tham chiếu); `teamVendorProblem` áp cho cả Evaluator; RoomStatus + locale | Unit vendor rule; client tests |

**Kết quả test 2026-11-11 (bản ba):** unit 11 file — **140/140 qua**; e2e regression goal/quyền — **27/27 qua**; client tests — **28/28**; typecheck server + app sạch. E2E POSIX-gated (`writes-audit`, `verify-gate`, `research-gate`) chờ CI Linux.

**Còn mở (chỉ còn việc chờ đặc tả/ngoài app):** B10 provenance (máy GPU); viết đầy đủ `docs/plans/research-workflow.md` + playbook + kịch bản nghiệm thu hai Lead (§6, cần duyệt bản nháp); §8.6-4 (hai goal cùng room); đường truyền GPU (§3.3).
