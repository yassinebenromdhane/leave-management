// Toast region + hook. Mutations push a toast; Undo toasts last 6 s and call the server inverse.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { UndoToast } from "@/common/components/UndoToast";

type ToastItem = { id: number; message: string; tone: "success" | "error"; onUndo?: () => void | Promise<void> };
type Push = (t: { message: string; tone?: "success" | "error"; onUndo?: () => void | Promise<void> }) => void;

const ToastContext = createContext<Push>(() => {});
export const useToast = (): Push => useContext(ToastContext);

let nextId = 1;

export function ToastProvider({ children, regionClassName }: { children: ReactNode; regionClassName?: string }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback<Push>((t) => {
    const id = nextId++;
    setItems((xs) => [...xs.slice(-3), { id, message: t.message, tone: t.tone ?? "success", onUndo: t.onUndo }]);
  }, []);
  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className={cn("pointer-events-none fixed inset-x-4 bottom-4 z-[80] flex flex-col items-center gap-2 max-md:bottom-20 md:items-start md:ps-16", regionClassName)}>
        {items.map((it) => (
          <div key={it.id} className="w-full max-w-md">
            <UndoToast
              message={it.message}
              tone={it.tone}
              onDismiss={() => dismiss(it.id)}
              durationMs={it.tone === "error" ? 8000 : 6000}
              onUndo={
                it.onUndo
                  ? () => {
                      dismiss(it.id);
                      void it.onUndo?.();
                    }
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
