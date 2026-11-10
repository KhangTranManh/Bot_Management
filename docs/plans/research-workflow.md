# Workflow nghiên cứu và huấn luyện — đặc tả (máy trạng thái)

Phiên bản đặc tả: 0.1 (bản nháp, chưa duyệt). Không sửa code; mọi cơ chế mới nằm ở `NOTE.md` mục 3.

## 0. Quy ước

- **"Xong"** = mọi thước đo trong file goal đạt ngưỡng trên tập đánh giá khoá, với số seed đã khai. Test pass không đủ.
- **Nhãn luật** (gắn theo trạng thái code hôm nay, không theo đích đến):
  - **CỨNG**: server chặn thật.
  - **MỀM**: chỉ nằm trong playbook/prompt; phụ thuộc model tuân thủ.
  - **PHÁT HIỆN SAU**: một script hoặc người kiểm sau khi việc đã xảy ra.
- **Số liệu là tham chiếu.** Mọi số trong đầu ra của bất kỳ vai nào ghi dạng
  `{"file": "<đường dẫn>", "pointer": "<JSON pointer>", "sha256": "<hash file>"}`. Không vai nào gõ số thô.
  Script điền số vào báo cáo (mẫu ở `research-templates.md`, bước sau).
- **Máy GPU là máy khác.** Bot không điều khiển máy GPU; chỉ đọc file kết quả đã chuyển về
  (đường truyền: [CHỜ QUYẾT 6]).
- Các chỗ **[CHỜ QUYẾT n]** khớp với `NOTE.md` mục 6.4; giá trị trong ngoặc là mặc định đề xuất.

## 1. Vai

| Vai | Làm gì | Mức quyền riêng của bot (cấu hình, mức A) | Vendor |
|---|---|---|---|
| Lead | Lập kế hoạch, giao việc, nhận kết quả, chọn chuyển trạng thái, ghi ledger | Ask | bất kỳ |
| Researcher | Tầng 1: tìm tài liệu, đề xuất giả thuyết | **Ask** | bất kỳ |
| Worker | Viết/sửa code thí nghiệm, script, cấu hình trong vùng `writes` | Ask hoặc Auto-accept edits | khác Evaluator và Reviewer [CHỜ QUYẾT 5] |
| Evaluator | Gọi script đánh giá cố định, trích kết quả bằng tham chiếu | **Ask** | khác Worker |
| Reviewer | Đọc log gốc và manifest, kiểm kết luận không vượt bằng chứng | **Ask** | khác Worker |
| Tester | Như workflow code: chạy kiểm tra code/script trước khi bàn giao GPU | Ask hoặc Auto-accept edits | bất kỳ |

Điều kiện để "mức Ask" là CỨNG: bot nhận việc dùng mức riêng của nó khi chạy (`server/index.ts:3083`), và **không** có
Chief of Staff phía trên chuỗi giao việc (Chief nâng quyền: `server/host/delegated-level.ts:41-52`). Chưa kiểm chứng
bằng e2e. Nếu một bot giữ hai vai trong hai room khác nhau, mức riêng của nó là mức cao hơn cần cho cả hai — khi đó
mức Ask không còn CỨNG cho vai chỉ-đọc. Quy định: **mỗi bot chỉ một vai trong workflow nghiên cứu.**

Phương án đã loại: dựa vào chế độ `consult` để chặn ghi — chưa chặn thật (`NOTE.md` mục 1.1).

## 2. Đầu ra của Lead (một khối JSON mỗi lượt)

Lead kết thúc mỗi lượt bằng đúng một khối:

```json
{
  "state": "<trạng thái hiện tại>",
  "next": "<trạng thái kế tiếp, phải có trong bảng chuyển của trạng thái hiện tại>",
  "reason": "<một mã lý do trong danh sách đóng ở mục 5>",
  "refs": [{"file": "...", "pointer": "...", "sha256": "..."}],
  "tasks": [ /* phiếu giao việc, chỉ khi next là trạng thái giao việc */ ],
  "ask": "<câu hỏi cho bạn, chỉ khi next là NEED_YOU>",
  "ledger": { /* dòng ledger, chỉ ở DECIDE */ }
}
```

- Mã `next` ngoài bảng chuyển, hoặc `reason` ngoài danh sách đóng: lượt đó **không hợp lệ**; Lead làm lại một lần,
  sai lần hai thì chuyển `BLOCKED` với `reason: "INVALID_OUTPUT"`. Hiện là MỀM (validator chạy tay); CỨNG khi app
  kiểm schema (cùng cơ chế với envelope `<openmaus-goal>`, `server/group-goal-run.ts`).
- Lead **không** viết số trong `ask`, `ledger` hay phần chữ gửi bạn; chỉ dùng `refs`.

Phương án đã loại: playbook văn xuôi để Lead tự diễn giải — hai model đọc khác nhau, không so sánh được.

## 3. Trạng thái và bảng chuyển

Ký hiệu cổng: [C] CỨNG, [M] MỀM, [S] PHÁT HIỆN SAU.

### Tầng 1 — chọn hướng (rẻ, chỉ đọc)

| Trạng thái | Ai | Đầu vào | Đầu ra | Cổng | Chuyển |
|---|---|---|---|---|---|
| `T1_SEARCH` | Researcher | Câu hỏi nghiên cứu của bạn | Danh sách nguồn: đường dẫn/URL, mỗi nguồn một dòng tóm tắt | [C nếu bot ở Ask] không ghi file | đủ ≥ 3 nguồn → `T1_HYPOTHESES`; không tìm được → `NEED_YOU` (`NO_SOURCES`) |
| `T1_HYPOTHESES` | Researcher, Lead tổng hợp | Nguồn | 1–5 giả thuyết, mỗi cái: thước đo dùng để kiểm, chi phí GPU ước tính (giờ), cách làm sai, nguồn | [M] mỗi giả thuyết đủ 4 trường | luôn → `T1_CHOICE` |
| `T1_CHOICE` | **Bạn** | Danh sách giả thuyết | Một giả thuyết được chọn, hoặc dừng | [C] goal dừng ở `needs-input` cho tới khi bạn trả lời | chọn → `T2_CONTRACT`; dừng → `STOPPED` (`USER_STOP`) |

### Tầng 2 — chạy thí nghiệm

| Trạng thái | Ai | Đầu vào | Đầu ra | Cổng | Chuyển |
|---|---|---|---|---|---|
| `T2_CONTRACT` | Lead soạn, **bạn duyệt** | Giả thuyết đã chọn | File goal (mẫu ở `research-templates.md`): thước đo, split, ngưỡng, `minDelta`, seed, ngân sách, điều kiện dừng, tập khoá, script đánh giá + hash | [C] goal dừng ở `needs-input` cho tới khi bạn duyệt | duyệt → `T2_LOCK`; sửa → ở lại `T2_CONTRACT` |
| `T2_LOCK` | Lead | File goal đã duyệt | `goal.lock.json`: sha256 của file goal và của script đánh giá | [S] script so hash ở mọi trạng thái sau; [C] khi có B2 | luôn → `T2_PILOT_PLAN` |
| `T2_PILOT_PLAN` | Lead | goal đã khoá | Phiếu giao việc pilot (1–2 mẫu), `locks: ["gpu"]` | [C] plan check theo vai, `writes` bắt buộc với Worker (`server/team-roles.ts`) | → `T2_BUILD` |
| `T2_BUILD` | Worker, rồi Tester | Phiếu giao việc | Code/script/cấu hình trong vùng `writes`; Tester chạy kiểm tra cục bộ | [C] trần vòng sửa 3 (`TEAM_MAX_FIX_ROUNDS`); [M] chỉ ghi trong `writes`; [S] so file đổi (B0(iii), chưa có) | Tester PASS → `T2_HANDOFF_GPU`; hết vòng sửa → `BLOCKED` (`FIX_ROUNDS_SPENT`) |
| `T2_HANDOFF_GPU` | Lead | Code đã qua Tester | Gói bàn giao: lệnh/notebook chính xác, commit, hash cấu hình, tên khoá `gpu`, đường dẫn kết quả mong đợi | [M] Lead phải dừng ở đây; [C] khi app có B11 | luôn → `NEED_YOU` (`GPU_RUN_NEEDED`) |
| `T2_WAIT_RESULTS` | **Bạn** | Gói bàn giao | Thư mục kết quả có `manifest.json` (mẫu ở `research-templates.md`) | [C] goal dừng ở `needs-input` | có file → `T2_CHECK_PROVENANCE`; huỷ → `STOPPED` (`USER_STOP`) |
| `T2_CHECK_PROVENANCE` | Evaluator (script) | Thư mục kết quả | Báo cáo kiểm: manifest đủ trường, hash cấu hình khớp gói bàn giao, mọi run có trong ledger, số mẫu = kích thước tập đã khai, không NaN, không có từ khoá lỗi trong log | [S] script kiểm (B10a, d, e) | đạt → `T2_EVALUATE`; lệch → `BLOCKED` (`PROVENANCE_MISMATCH`) |
| `T2_EVALUATE` | Evaluator | Checkpoint/kết quả (bản copy bất biến) + tập khoá | File kết quả đánh giá do **script cố định** sinh ra; Evaluator chỉ trả `refs` | [S] hash script khớp `goal.lock.json`; [S] quét log tìm đường dẫn tập khoá ở lượt Worker (B3); [M] Evaluator không tự tính | có file → `T2_REVIEW`; script lỗi → `BLOCKED` (`EVAL_FAILED`) |
| `T2_REVIEW` | Reviewer (khác vendor) | Log gốc, manifest, kết quả đánh giá — **không** đọc tóm tắt của Worker | Danh sách vấn đề, mỗi cái kèm `refs`; kết luận "đủ bằng chứng" / "không đủ" | [M] kết luận không vượt bằng chứng (một seed không đủ cho "cải thiện nhờ X") | → `T2_DECIDE` |
| `T2_DECIDE` | Lead | Kết quả đánh giá, review, ledger | Một quyết định theo bảng mục 4; một dòng ledger | [M] quyết định theo bảng; [S] validator số liệu (B10c) | xem mục 4 |
| `T2_REPORT` | Lead (script điền số) | Ledger, kết quả | Báo cáo từ mẫu; mọi số do script điền | [S] validator so từng số với file nguồn, lệch thì từ chối | đạt → `DONE`; lệch → `BLOCKED` (`REPORT_MISMATCH`) |

### Trạng thái kết thúc và chờ

| Trạng thái | Nghĩa |
|---|---|
| `NEED_YOU` | Goal dừng ở `needs-input` (cơ chế sẵn có). Kèm `reason` và `ask`. Bạn trả lời thì quay lại trạng thái ghi trong `ask`. |
| `BLOCKED` | Goal dừng ở `blocked` kèm `reason`. Chạy lại cần bạn gửi lại goal. |
| `STOPPED` | Bạn dừng hoặc ngân sách hết. |
| `DONE` | Mọi thước đo đạt ngưỡng; báo cáo qua validator. |

## 4. Bảng quyết định ở `T2_DECIDE` (đóng, xét theo thứ tự, dòng đầu khớp thì dùng)

Định nghĩa: **cải thiện** = thước đo chính tăng ít nhất `minDelta` so với vòng tốt nhất trước đó, trung bình trên mọi
seed đã khai, và không thước đo phụ nào giảm quá `maxRegression` (cả hai khai trong file goal).

| # | Điều kiện | Quyết định | `next` | `reason` |
|---|---|---|---|---|
| 1 | Hash goal hoặc script đánh giá khác `goal.lock.json` | dừng | `BLOCKED` | `CONTRACT_CHANGED` |
| 2 | Có cờ truy cập tập khoá ngoài Evaluator (B3) | dừng | `BLOCKED` | `PROTECTED_SET_TOUCHED` |
| 3 | Pilot chưa PASS mà vòng này là chạy đầy đủ | đổi hướng | `T2_PILOT_PLAN` | `PILOT_REQUIRED` |
| 4 | Mọi thước đo đạt ngưỡng, đủ số seed, Reviewer "đủ bằng chứng" | tiếp tục tới báo cáo | `T2_REPORT` | `TARGET_MET` |
| 5 | Ngân sách vòng hoặc giờ đã hết (tính từ ledger) | dừng | `STOPPED` | `BUDGET_SPENT` |
| 6 | N vòng liên tiếp không cải thiện (N [CHỜ QUYẾT 4], mặc định 2) | dừng | `STOPPED` | `NO_IMPROVEMENT` |
| 7 | Vòng này cải thiện | tiếp tục | `T2_PILOT_PLAN` | `IMPROVED` |
| 8 | Vòng này không cải thiện, còn ngân sách | đổi hướng: Lead đề xuất thay đổi, **bạn duyệt** | `NEED_YOU` | `CHANGE_DIRECTION` |

Kết quả âm (dòng 6, 8) vẫn ghi ledger. Lead không được chọn dòng ngoài bảng.

Phương án đã loại: để Lead tự cân nhắc "tiếp tục hay không" — hai model khác nhau cho quyết định khác nhau.

## 5. Danh sách mã lý do (đóng)

`NO_SOURCES`, `USER_STOP`, `FIX_ROUNDS_SPENT`, `GPU_RUN_NEEDED`, `PROVENANCE_MISMATCH`, `EVAL_FAILED`,
`CONTRACT_CHANGED`, `PROTECTED_SET_TOUCHED`, `PILOT_REQUIRED`, `TARGET_MET`, `BUDGET_SPENT`, `NO_IMPROVEMENT`,
`IMPROVED`, `CHANGE_DIRECTION`, `REPORT_MISMATCH`, `INVALID_OUTPUT`, `UNSURE_GOAL`, `UNSURE_PERMISSION`,
`OUT_OF_USAGE`, `GPU_LOCK_BUSY`.

- `UNSURE_GOAL`, `UNSURE_PERMISSION`: Lead dùng khi không chắc về mục tiêu hoặc quyền; luôn đi tới `NEED_YOU`.
- `OUT_OF_USAGE`: một bot hết quota và không còn bot cùng vai (cơ chế 3.1 sẵn có) → `BLOCKED`.
- `GPU_LOCK_BUSY`: hai việc cùng xin khoá `gpu` trong một goal thì app tự xếp nối tiếp (`server/lead-schedule.ts`,
  CỨNG); mã này chỉ dùng khi khoá bị giữ ở room khác — app chưa có khoá xuyên room, nên đây là MỀM.

## 6. Bộ đếm và trần

| Bộ đếm | Trần | Nguồn | Loại |
|---|---|---|---|
| Vòng sửa trong `T2_BUILD` | 3 | `TEAM_MAX_FIX_ROUNDS`, `server/team-roles.ts` | CỨNG |
| Vòng thí nghiệm | `budget.rounds` [CHỜ QUYẾT 4], mặc định 5 | ledger | PHÁT HIỆN SAU (guard chạy tay); CỨNG khi có B7 |
| Giờ GPU | `budget.hours` | `manifest.json` (thời gian bắt đầu/kết thúc) | PHÁT HIỆN SAU |
| Vòng liên tiếp không cải thiện | N, mặc định 2 | ledger | PHÁT HIỆN SAU |
| Lượt goal của app | 13 (một batch song song = 1) | `GROUP_GOAL_MAX_TURNS` | CỨNG |

Giới hạn 13 lượt của app nhỏ hơn số lượt một vòng thí nghiệm đầy đủ cần. Quy định: mỗi lần chạy goal chỉ đi **một
vòng** (từ `T2_PILOT_PLAN` tới `T2_DECIDE`); vòng sau là một lần gửi goal mới, đọc ledger để tiếp tục.
Phương án đã loại: nâng trần lượt của app — phải sửa server, trong khi chia theo vòng giải được bằng quy trình.

## 7. Ánh xạ chặng → cơ chế

| Chặng | Đã có trong code | Thiếu | Mức cần |
|---|---|---|---|
| Dừng chờ bạn (`T1_CHOICE`, `T2_CONTRACT`, `T2_WAIT_RESULTS`) | `needs-input` của goal | — | — |
| Chỉ-đọc cho Researcher/Evaluator/Reviewer | Mức riêng của bot ở Ask | Trần quyền theo vai (B0(i)) | A ngay; C sau |
| Kiểm schema đầu ra Lead | Envelope `<openmaus-goal>` | Schema research | B (validator) rồi C |
| Khoá hợp đồng | — | `goal.lock.json` + so hash | B rồi C (B2) |
| Plan check theo vai, `writes` | `server/team-roles.ts` | Ràng buộc vendor (B4), pilot (B6) | C |
| Vòng sửa có trần | Có | — | — |
| Khoá `gpu` trong một goal | `locks`, `server/lead-schedule.ts` | Khoá xuyên room | C nếu cần |
| PASS của Tester có bằng chứng | Dòng `VERDICT` | Đối chiếu event log (B0(ii)) | C |
| So file đổi với `writes` | — | B0(iii) | B/C |
| Provenance (manifest, script đánh giá, validator, đối chiếu run) | — | B10 | B (ngoài app) |
| Ledger và guard ngân sách | — | B7 | B rồi C |
| Hết quota giao lại cùng vai | Có (3.1) | Kiểm vendor sau khi đổi engine | C |

## 8. Việc còn lại (theo `NOTE.md` mục 6.5)

- Bước 3: `docs/plans/research-templates.md` — mẫu file goal, phiếu giao việc, dòng ledger, manifest, báo cáo; đặc tả validator.
- Bước 4: playbook Lead (vừa 12.000 ký tự của `bulletin`) và thẻ vai.
- Bước 5: bộ kịch bản nghiệm thu mô hình đồ chơi, tiêu chí so sánh hai Lead bằng chuỗi `state`/`next`/`reason`.
