import { Building2 } from "lucide-react";
import { useStore } from "@/state/store";
import { officeNeeds, officeRooms } from "./office-model";

export function OfficeNav({ icons = false, onOpen }: { icons?: boolean; onOpen?(): void }) {
  const { state, dispatch } = useStore();
  const count = officeNeeds(officeRooms(state.groups)).length;
  return <button type="button" data-office-nav aria-label="Văn phòng" aria-current={state.activeView === "office" ? "page" : undefined}
    className="office-nav" title="Văn phòng" onClick={() => { dispatch({ type: "showOffice" }); onOpen?.(); }}>
    <Building2 size={17} aria-hidden="true" />
    {!icons && <span>Văn phòng</span>}
    {count > 0 && <span className="office-nav-count" aria-label={`${count} việc cần bạn`}>{count}</span>}
  </button>;
}
