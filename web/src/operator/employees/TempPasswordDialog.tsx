import { Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog } from "@/ui/Dialog";

/** Shown exactly once: the server never returns the temporary password again. */
export function TempPasswordDialog({ name, temporaryPassword, loginIdentifier, onClose }: { name: string; temporaryPassword: string; loginIdentifier: string; onClose: () => void }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog
      title={t("portal.tempTitle", { name })}
      onClose={onClose}
      actions={
        <button type="button" onClick={onClose} className="h-9 rounded-md bg-accent px-4 text-accent-foreground max-md:h-11" data-autofocus>
          {t("common.done")}
        </button>
      }
    >
      <dl className="space-y-3">
        <div>
          <dt className="text-meta text-muted-foreground">{t("portal.loginIdentifier")}</dt>
          <dd className="font-medium">{loginIdentifier}</dd>
        </div>
        <div>
          <dt className="text-meta text-muted-foreground">{t("portal.tempPassword")}</dt>
          <dd className="flex items-center gap-2">
            <code className="rounded border bg-muted px-2 py-1 text-[15px] tabular-nums select-all" data-testid="temp-password">
              {temporaryPassword}
            </code>
            <button type="button" onClick={() => void copy()} className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 hover:bg-muted max-md:h-11">
              <Copy size={14} aria-hidden="true" />
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-meta text-muted-foreground">{t("portal.shownOnce")}</p>
    </Dialog>
  );
}
