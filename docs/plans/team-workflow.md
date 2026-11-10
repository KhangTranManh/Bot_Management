# Workflow nhóm — 1 Lead + tối đa 5 bot

Việc chạy bằng cơ chế goal; chat là để người nói chuyện với nhóm. Mỗi bước là một commit riêng, có test,
và cuối cùng chạy regression.

## Giai đoạn 1 — Ổn định nền

- **1.1** Tin của người gửi lead không huỷ việc lead đã giao: worker chạy tiếp, chỉ Stop mới huỷ cả cây.
- **1.2** Lượt chỉ-đọc (lane trả lời, Tester, Reviewer) bị chặn ghi file thật, không chỉ bằng prompt.
- **1.3** Bỏ cờ `OMB_LEAD_DEPT_CAP`: room từ 3 bot chạy sóng song song mặc định, công tắc tắt theo room.

## Giai đoạn 2 — Vai trò và luồng

- **2.1** Vai cố định trong hồ sơ bot: Lead / Worker / Tester / Reviewer; lead chỉ giao đúng vai.
- **2.2** Task Worker bắt buộc khai `writes`; cùng file thì nối tiếp.
- **2.3** Cổng Tester: không có Tester pass thì không được `completed`.
- **2.4** Vòng sửa: Tester fail → giao lại đúng Worker kèm lỗi, tối đa N vòng rồi `blocked`.
- **2.5** Ngân sách theo vòng (kế hoạch → làm → test) thay cho 13 lượt.
- **2.6** Tự nhận diện: room rảnh + yêu cầu làm việc → chạy goal; `/goal`, `/chat` ép chế độ; công tắc theo room.

## Giai đoạn 3 — Chịu lỗi

- **3.1** Bot hết quota / lỗi tài khoản → "không khả dụng", tự giao lại cho bot rảnh cùng vai.
- **3.2** Engine dự phòng theo bot (tuỳ chọn).

## Giai đoạn 4 — Theo dõi

- **4.1** Room nhận "việc đang làm" mới nhất của từng lane; panel và sidebar hiện công cụ, file, thời gian.
- **4.2** Kết quả worker và tin dài thu gọn thành thẻ 2–3 dòng.
- **4.3** Hỏi tiến độ → server tự tổng hợp trả lời, không chiếm lượt bot.

## Chưa chắc chắn

- 1.2: engine nào chặn ghi thật được; có thể phải dùng chế độ xin phép.
- 3.2: đổi engine giữa chừng mất ngữ cảnh phiên; task chạy lại trong lane mới.

## Tiến độ

| Bước | Trạng thái | Commit | Ghi chú |
|---|---|---|---|
| 1.1 | Xong | b33a70e48 | Side-reply mở rộng cho mọi lúc room bận, không chỉ goal. Gốc yêu cầu là thành viên rảnh. Stop vẫn dừng cả cây (có chủ đích, test `direct-coordination` khẳng định). |
| 1.2 | Xong | fc8ff3d06 | Lượt `consult` chạy ở mức `ask` (ghi/chạy lệnh phải xin phép); side-reply dùng `consult`. Tester cần chạy lệnh nên vẫn là `work`, Reviewer dùng `consult`. |
| 1.3 | Xong | f68cf9f7e | Sóng song song mặc định ở room ≥ 3 thành viên; công tắc "Goal chạy song song" trong panel room; `OMB_LEAD_DEPT_CAP=0/1` vẫn ép tắt/bật. |
| 2.1–2.5 | Xong | 2a843c1cb | Vai đặt **theo room** (không theo hồ sơ bot, vì một bot có thể khác vai ở room khác): chọn trong Team status. Lead của room làm điều phối goal. Kế hoạch sai vai hoặc Worker thiếu `writes` bị trả lại (3 lần thì blocked). Có Worker mà không có Tester thì tự thêm task Tester. Không cho `completed` khi Tester chưa PASS; FAIL → vòng sửa, tối đa 3. Reviewer chạy `consult` (chỉ đọc). Một batch song song = 1 lượt. |
| 2.6 | Xong | 91448816c | Room có Lead (hoặc bật công tắc "Tự chạy yêu cầu làm việc như goal"): tin bắt đầu bằng động từ làm việc (làm/sửa/thêm/build/fix…), không phải câu hỏi, không tag ai → chạy goal. `/chat` ở đầu tin ép chat thường. |
| 3.1 | Xong | b4c310c01 | Thành viên hết quota/credit trong goal: không thử lại, bị loại khỏi lượt chạy, lead được báo giao task cho thành viên rảnh cùng vai (không có vai thì bất kỳ ai trừ lead); không còn ai → `blocked` có lý do. Kế hoạch giao lại cho bot đã hết quota bị trả lại. |
| 3.2 | Đã có sẵn | — | `limit-takeover` / `quota-switch`: bot tự chạy tiếp trên AI dự phòng mà người dùng đã cài khi hết quota hoặc bị đăng xuất. Không cần code mới; 3.1 là lớp đỡ khi không có dự phòng. |
| 4.1 | Xong | ac0fbac13 | `GET /api/groups/:id/now`: việc mỗi thành viên đang chạy/đang chờ (task, lane, thời gian, bước mới nhất). Team status trong panel room và panel goal hỏi 3 giây/lần. Kèm sửa side-reply: gốc yêu cầu thử lần lượt thành viên, ưu tiên người rảnh hẳn, để tag bot thứ ba vẫn chạy khi lead và một worker đang bận. |
| 4.2 | Xong | (commit này) | Tin bot trong room dài hơn 1200 ký tự hoặc 16 dòng được thu gọn kèm "Xem đầy đủ". Kết quả của worker vốn đã thu gọn qua `ToolActivity`. |
