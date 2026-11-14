import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { REFERENCES, type AppliedReference } from "../../shared/references";
import { Card } from "./SettingsPrimitives";

function List({ label, items }: { label: string; items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-2 text-[13px] leading-relaxed text-ink-secondary">
      <span className="font-medium text-ink">{label}</span>
      <ul className="mt-0.5 list-disc pl-5">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function ReferenceRow({ reference }: { reference: AppliedReference }) {
  return (
    <div data-reference={reference.id} data-status={reference.status} className="border-t-[0.5px] border-(--settings-edge) py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <a href={reference.url} target="_blank" rel="noreferrer" className="text-[14px] font-medium text-ink underline-offset-2 hover:underline">{reference.name}</a>
        <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[12px] text-ink-secondary">{t(`settings.references.status.${reference.status}` as LocaleKey)}</span>
        <span className="text-[12px] text-ink-secondary">{reference.license} · {reference.date}</span>
      </div>
      <List label={t("settings.references.took")} items={reference.took} />
      <List label={t("settings.references.leftOut")} items={reference.leftOut} />
      <List label={t("settings.references.appliedIn")} items={reference.appliedIn} />
      {reference.evidence && (
        <div className="mt-2 text-[13px] leading-relaxed text-ink-secondary">
          <span className="font-medium text-ink">{t("settings.references.evidence")}</span> {reference.evidence}
        </div>
      )}
    </div>
  );
}

export function AppliedReferencesSettings() {
  return (
    <Card title={t("settings.references.title")} subtitle={t("settings.references.subtitle")}>
      {REFERENCES.map((reference) => <ReferenceRow key={reference.id} reference={reference} />)}
    </Card>
  );
}
