// Attachment drop zone (spec 1.2): drag and drop, paste or click; PDF / JPG / PNG up to 10 MB.
// Props-only: it validates the file and hands it to the parent, which uploads after the leave is saved.
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MIME_TYPES } from "@leave/shared";
import { Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type AttachmentRejection = "attachments.errors.tooLarge" | "attachments.errors.type" | "attachments.errors.empty";

/** Client-side mirror of the server checks, so the user gets feedback before any upload. */
export function validateAttachment(file: Pick<File, "size" | "type">): AttachmentRejection | null {
  if (file.size === 0) return "attachments.errors.empty";
  if (file.size > ATTACHMENT_MAX_BYTES) return "attachments.errors.tooLarge";
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) return "attachments.errors.type";
  return null;
}

export function AttachmentDrop({
  file,
  onFile,
  onClear,
  required,
  present,
  disabled,
  touch,
  camera,
}: {
  file: File | null;
  onFile: (file: File) => void;
  onClear: () => void;
  /** The leave type requires a supporting document. */
  required?: boolean;
  /** A document is already attached (pending file or saved attachment). */
  present?: boolean;
  disabled?: boolean;
  /** 44 px targets at every width (phone layout). */
  touch?: boolean;
  /** Offer "Take a photo" (rear camera) next to the file chooser. */
  camera?: boolean;
}) {
  const { t } = useTranslation();
  const [over, setOver] = useState(false);
  const [error, setError] = useState<AttachmentRejection | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const size = touch ? "h-11 min-w-11" : "h-8 max-md:h-11";
  const onFileRef = useRef(onFile);
  onFileRef.current = onFile;

  const accept = (f: File | undefined) => {
    if (!f) return;
    const problem = validateAttachment(f);
    setError(problem);
    if (!problem) onFileRef.current(f);
  };

  // Paste a screenshot or a copied file anywhere while the drawer is open.
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0];
      if (f) {
        e.preventDefault();
        accept(f);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [disabled]);

  const missing = Boolean(required) && !present;
  return (
    <div className="space-y-1.5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (!disabled) accept(e.dataTransfer.files[0]);
        }}
        className={cn("flex min-h-12 flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2", over && "border-accent bg-accent/5", disabled && "opacity-60")}
      >
        <Paperclip size={14} aria-hidden="true" className={missing ? "text-status-pending" : "text-muted-foreground"} />
        {file ? (
          <>
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <button type="button" onClick={onClear} aria-label={t("attachments.remove")} className={cn("grid h-8 w-8 place-items-center rounded hover:bg-muted max-md:h-11 max-md:w-11", touch && "h-11 w-11")}>
              <X size={14} aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-muted-foreground">{t(touch ? "attachments.dropTouch" : "attachments.drop")}</span>
            {camera ? (
              <button type="button" disabled={disabled} onClick={() => photo.current?.click()} className={cn(size, "rounded-md border px-2.5 hover:bg-muted")}>
                {t("attachments.takePhoto")}
              </button>
            ) : null}
            <button
              type="button"
              disabled={disabled}
              onClick={() => input.current?.click()}
              className={cn(size, "rounded-md border px-2.5 hover:bg-muted")}
            >
              {t("attachments.choose")}
            </button>
          </>
        )}
        <input
          ref={input}
          type="file"
          hidden
          accept={ATTACHMENT_MIME_TYPES.join(",")}
          onChange={(e) => {
            accept(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {camera ? (
          <input
            ref={photo}
            type="file"
            hidden
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              accept(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        ) : null}
      </div>
      {missing ? (
        <p className="flex items-center gap-1.5 text-meta text-status-pending" data-testid="attachment-missing">
          <Paperclip size={12} aria-hidden="true" />
          {t("attachments.required")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-meta text-status-rejected">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}
