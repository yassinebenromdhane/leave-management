import type { LeaveStatus } from "@leave/shared";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusPill } from "@/common/components/StatusPill";
import { MenuItem, Popover } from "@/ui/Popover";
import { allowedTransitions } from "./status";

/** Click the pill to change status (spec 1.2). */
export function StatusMenu({ status, onChange }: { status: LeaveStatus; onChange: (to: LeaveStatus) => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <StatusPill ref={ref} status={status} onClick={() => setOpen((o) => !o)} />
      {open ? (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} label={t("status.menu")}>
          {allowedTransitions(status).map((to) => (
            <MenuItem
              key={to}
              onClick={() => {
                setOpen(false);
                onChange(to);
              }}
            >
              <StatusPill status={to} />
            </MenuItem>
          ))}
        </Popover>
      ) : null}
    </>
  );
}
