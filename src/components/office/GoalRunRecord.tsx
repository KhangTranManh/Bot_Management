import { checkPassed, type GoalBaseline, type GoalBrief, type GoalCheckResult, type GoalConflict, type GroupGoalRunCardData } from "../../../shared/group-goal-run";

const OUTPUT_LIMIT = 1000;

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function BriefList({ title, items, warn = false }: { title: string; items: readonly string[]; warn?: boolean }) {
  if (!items.length) return null;
  return <div data-goal-brief-list={title} className={warn ? "is-warning" : undefined}>
    <h4>{title}</h4>
    <ul>{items.map((item, index) => <li key={index} dir="auto">{item}</li>)}</ul>
  </div>;
}

function BriefSection({ brief }: { brief: GoalBrief }) {
  return <section data-goal-brief><h3>Brief của Lead</h3>
    <p dir="auto"><strong>{brief.goal}</strong></p>
    <BriefList title="Câu hỏi mở" items={brief.openQuestions} warn />
    <BriefList title="Trong phạm vi" items={brief.inScope} />
    <BriefList title="Ngoài phạm vi" items={brief.outOfScope} />
    <BriefList title="Tiêu chí nghiệm thu" items={brief.acceptance} />
    <BriefList title="Ràng buộc" items={brief.constraints} />
    {brief.structure?.length ? <div data-goal-structure>
      <h4>Cấu trúc · mỗi task của Worker ghi trong một vùng</h4>
      <ul>{brief.structure.map((area) => <li key={area.name} data-goal-area={area.name} data-read-only={area.readOnly === true}>
        <strong>{area.name}{area.readOnly ? " · chỉ đọc" : ""}</strong>
        <code>{area.paths.join(", ")}</code>
        <span dir="auto">{area.owns}</span>
      </li>)}</ul>
    </div> : null}
  </section>;
}

function CheckRow({ phase, check }: { phase: string; check: GoalCheckResult }) {
  const passed = checkPassed(check);
  return <li data-goal-check={check.id} data-passed={passed}>
    <strong>{phase} · {check.id} · {passed ? "đạt" : "lỗi"}</strong>
    <span>{check.exitCode === null ? "Không chạy được hoặc bị dừng" : `Mã thoát ${check.exitCode}`} · mong đợi {check.expectExit}</span>
    {check.output && <details><summary>Output</summary><pre>{check.output.slice(-OUTPUT_LIMIT)}</pre></details>}
  </li>;
}

function BaselineSection({ baseline }: { baseline: GoalBaseline }) {
  const all = [...baseline.setup, ...baseline.checks];
  const passed = all.filter(checkPassed).length;
  return <section data-goal-baseline><h3>Trạng thái gốc</h3>
    <p>{all.length ? `${passed}/${all.length} lệnh đạt` : "Chưa cấu hình setup hoặc verify: trạng thái gốc chưa được kiểm chứng."}{baseline.finishedAt ? ` · xong lúc ${clock(baseline.finishedAt)}` : " · đang chạy"}</p>
    {all.length > 0 && <ul>
      {baseline.setup.map((check) => <CheckRow key={`setup:${check.id}`} phase="Setup" check={check} />)}
      {baseline.checks.map((check) => <CheckRow key={`verify:${check.id}`} phase="Verify" check={check} />)}
    </ul>}
    {passed < all.length && baseline.setup.every(checkPassed) && <p>Lỗi có sẵn từ trước khi bot làm; cổng verify cuối goal vẫn yêu cầu sửa hết.</p>}
  </section>;
}

function ConflictSection({ conflicts }: { conflicts: readonly GoalConflict[] }) {
  return <section data-goal-conflicts><h3>Conflict giữa Worker · {conflicts.length}</h3>
    <p>Server thấy một Worker sửa file thuộc task của Worker khác trong lúc wave chạy; Lead đánh giá sau wave.</p>
    <ul>{[...conflicts].reverse().map((conflict) => <li key={`${conflict.at}:${conflict.file}:${conflict.otherBotId}`} data-goal-conflict={conflict.file}>
      <strong><code>{conflict.file}</code></strong>
      <span>{conflict.otherName} ({conflict.otherTask}) sửa file của {conflict.ownerName} ({conflict.ownerTask}) · {clock(conflict.at)}</span>
      <span>{conflict.steered ? "Đã nhắc lượt đang chạy dừng sửa file này." : "Không nhắc được giữa lượt: engine này không nhận tin nhắn khi đang chạy."}</span>
    </li>)}</ul>
  </section>;
}

export function goalRunFlags(run: GroupGoalRunCardData): string[] {
  const questions = run.brief?.openQuestions.length ?? 0;
  const baseline = run.baseline ? [...run.baseline.setup, ...run.baseline.checks].filter((check) => !checkPassed(check)).length : 0;
  const conflicts = run.conflicts?.length ?? 0;
  return [
    ...(questions ? [`${questions} câu hỏi mở`] : []),
    ...(conflicts ? [`${conflicts} conflict`] : []),
    ...(baseline ? [`gốc ${baseline} lệnh lỗi`] : []),
  ];
}

export function GoalRunFlags({ run }: { run: GroupGoalRunCardData }) {
  const flags = goalRunFlags(run);
  return flags.length ? <p data-goal-run-flags className="mt-1 text-[12px] text-warning">{flags.join(" · ")}</p> : null;
}

function PlanSourceSection({ source }: { source: NonNullable<GroupGoalRunCardData["planSource"]> }) {
  return <section data-goal-plan-source><h3>Bản phác thảo đã chốt</h3>
    <p>{source.source === "conversation" ? "Từ thẻ phác thảo trong cuộc trò chuyện" : "Từ hồ sơ dự án"}</p>
    <ol>{source.draft.waves.map((wave) => <li key={wave.name} data-plan-wave={wave.name} dir="auto"><strong>{wave.name}</strong> [{wave.areas.join(", ")}] — {wave.deliverable}</li>)}</ol>
    {source.changeReason && <p data-plan-change-reason dir="auto">Lead đổi brief: {source.changeReason}</p>}
  </section>;
}

/** What the run is held to and what it ran into: the Lead's brief, the project's state before any bot worked, and conflicts. */
export function GoalRunRecord({ run }: { run: GroupGoalRunCardData }) {
  if (!run.brief && !run.planSource && !run.baseline && !run.conflicts?.length) return null;
  return <div className="goal-insights goal-run-record">
    {run.planSource && <PlanSourceSection source={run.planSource} />}
    {run.brief && <BriefSection brief={run.brief} />}
    {run.baseline && <BaselineSection baseline={run.baseline} />}
    {run.conflicts?.length ? <ConflictSection conflicts={run.conflicts} /> : null}
  </div>;
}
