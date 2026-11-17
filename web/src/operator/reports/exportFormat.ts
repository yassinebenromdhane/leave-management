// Last-used export format, remembered in localStorage (spec 1.6). Default xlsx.
import { EXPORT_FORMATS, type ExportFormat } from "@leave/shared";
import { readStorage, writeStorage } from "@/common/lib/storage";

const KEY = "leave.exportFormat";

export function getExportFormat(): ExportFormat {
  const saved = readStorage(KEY);
  return (EXPORT_FORMATS as readonly string[]).includes(saved ?? "") ? (saved as ExportFormat) : "xlsx";
}

export const rememberExportFormat = (format: ExportFormat): void => writeStorage(KEY, format);
