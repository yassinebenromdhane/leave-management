// Per-row portal actions (spec 2.5): Invite, Temporary password, Portal access, Sign out everywhere.
import { MoreHorizontal } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { EmployeeRow, useEmployeeMutations } from "@/common/api/employees";
import { errorMessage } from "@/common/lib/errorMessage";
import { useToast } from "@/common/toast/ToastProvider";
import { MenuItem, Popover } from "@/ui/Popover";
import { TempPasswordDialog } from "./TempPasswordDialog";

type Mutations = ReturnType<typeof useEmployeeMutations>;

export function PortalMenu({ employee, mutations }: { employee: EmployeeRow; mutations: Mutations }) {
  const { t } = useTranslation();
  const toast = useToast();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<{ temporaryPassword: string; loginIdentifier: string } | null>(null);
  const archived = employee.status === "archived";

  const run = async (action: () => Promise<unknown>, success: string) => {
    setOpen(false);
    try {
      await action();
      toast({ message: success });
    } catch (err) {
      toast({ message: errorMessage(t, err), tone: "error" });
    }
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("portal.actionsFor", { name: employee.fullName })}
        onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded hover:bg-muted max-md:h-11 max-md:w-11"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open ? (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} label={t("portal.title")}>
          <MenuItem disabled={archived || !employee.email} onClick={() => void run(() => mutations.invite.mutateAsync(employee.id), t("portal.inviteSent", { name: employee.fullName }))}>
            {t("portal.invite")}
          </MenuItem>
          <MenuItem
            disabled={archived}
            onClick={() => {
              setOpen(false);
              mutations.temporaryPassword.mutate(employee.id, {
                onSuccess: (r) => setSecret(r),
                onError: (err) => toast({ message: errorMessage(t, err), tone: "error" }),
              });
            }}
          >
            {t("portal.tempPassword")}
          </MenuItem>
          <MenuItem
            disabled={archived}
            onClick={() =>
              void run(
                () => mutations.portalAccess.mutateAsync({ id: employee.id, enabled: !employee.portalAccess }),
                employee.portalAccess ? t("portal.disabled") : t("portal.enabled"),
              )
            }
          >
            {employee.portalAccess ? t("portal.disableAccess") : t("portal.enableAccess")}
          </MenuItem>
          <MenuItem onClick={() => void run(() => mutations.signOutEverywhere.mutateAsync(employee.id), t("portal.signedOutEverywhere"))}>
            {t("portal.signOutEverywhere")}
          </MenuItem>
        </Popover>
      ) : null}
      {secret ? <TempPasswordDialog name={employee.fullName} {...secret} onClose={() => setSecret(null)} /> : null}
    </>
  );
}
