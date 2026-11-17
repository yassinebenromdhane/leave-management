import { useTranslation } from "react-i18next";
import { Dialog } from "@/ui/Dialog";

const ROWS: Array<{ keys: string; action: string }> = [
  { keys: "C", action: "shortcuts.newLeave" },
  { keys: "E", action: "shortcuts.addEmployee" },
  { keys: "/", action: "shortcuts.search" },
  { keys: "T", action: "shortcuts.today" },
  { keys: "← / →", action: "shortcuts.period" },
  { keys: "W / M", action: "shortcuts.zoom" },
  { keys: "A", action: "shortcuts.approve" },
  { keys: "R", action: "shortcuts.reject" },
  { keys: "1-9", action: "shortcuts.leaveType" },
  { keys: "Ctrl+Enter", action: "shortcuts.save" },
  { keys: "Shift+Ctrl+Enter", action: "shortcuts.savePending" },
  { keys: "Esc", action: "shortcuts.close" },
  { keys: "?", action: "shortcuts.help" },
];

/** Lists every shortcut, translated. */
export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog title={t("shortcuts.title")} onClose={onClose}>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2">
        {ROWS.map((r) => (
          <div key={r.keys} className="contents">
            <dt>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 text-meta tabular-nums">{r.keys}</kbd>
            </dt>
            <dd>{t(r.action)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-meta text-muted-foreground">{t("shortcuts.typingNote")}</p>
    </Dialog>
  );
}
