"use client";

import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { X, CheckCircle2, AlertTriangle, AlertCircle, XCircle, Info } from "lucide-react";

const FLASH_KEY = "pbe_flash_toast";

// Writes a toast to sessionStorage so it survives a navigation/redirect — the
// destination page picks it up on mount via UIProvider's useEffect.
export function flashToast(message: string, type: "success" | "error" | "warning" | "info" = "success") {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, type })); } catch {}
}

// ─── Toast ───────────────────────────────────────────────────

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
}

interface UIContextType {
  toast: (message: string, type?: ToastType) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const UIContext = createContext<UIContextType>({
  toast: () => {},
  confirm: () => Promise.resolve(false),
});

export function useUI() {
  return useContext(UIContext);
}

// Matches the vendor-order toast: white card, bottom-right, soft halo around
// a tinted icon (green for success, red for error, etc.).
const TOAST_STYLES: Record<ToastType, { iconBg: string; iconColor: string; icon: React.ReactNode }> = {
  success: { iconBg: "bg-green-50", iconColor: "text-green-600", icon: <CheckCircle2 className="h-5 w-5" strokeWidth={2.2} /> },
  error: { iconBg: "bg-red-50", iconColor: "text-red-600", icon: <XCircle className="h-5 w-5" strokeWidth={2.2} /> },
  warning: { iconBg: "bg-orange-50", iconColor: "text-orange-600", icon: <AlertTriangle className="h-5 w-5" strokeWidth={2.2} /> },
  info: { iconBg: "bg-blue-50", iconColor: "text-blue-600", icon: <Info className="h-5 w-5" strokeWidth={2.2} /> },
};

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2000);
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(FLASH_KEY);
      if (raw) {
        sessionStorage.removeItem(FLASH_KEY);
        const { message, type } = JSON.parse(raw);
        if (message) showToast(message, type || "info");
      }
    } catch {}
  }, [showToast]);

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({ options, resolve });
    });
  }, []);

  function handleConfirmResponse(value: boolean) {
    confirmState?.resolve(value);
    setConfirmState(null);
  }

  return (
    <UIContext.Provider value={{ toast: showToast, confirm: showConfirm }}>
      {children}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => {
          const style = TOAST_STYLES[t.type];
          return (
            <div
              key={t.id}
              className="bg-white text-gray-900 px-4 py-3 rounded-lg shadow-lg border border-gray-200 flex items-center gap-3 min-w-[280px] max-w-[420px] pointer-events-auto animate-in slide-in-from-right"
            >
              <div className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${style.iconBg} ${style.iconColor}`}>
                {style.icon}
              </div>
              <span className="text-sm font-medium flex-1">{t.message}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="p-0.5 rounded hover:bg-gray-100 text-gray-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Confirm Dialog */}
      {confirmState && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => handleConfirmResponse(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-[420px] mx-4 overflow-hidden">
            <div className="p-6">
              <div className="flex flex-col items-center text-center">
                {/* Halo + icon — every confirm dialog uses the red AlertCircle in a
                    soft halo (matches vendor-order). Variant only affects the
                    confirm button colour, not the icon. */}
                <div className="h-14 w-14 rounded-full flex items-center justify-center mb-4 ring-8 bg-red-50 ring-red-50/60">
                  <AlertCircle className="h-7 w-7 text-red-600" strokeWidth={2} />
                </div>
                <h3 className="text-base font-semibold text-gray-900">{confirmState.options.title}</h3>
                <p className="text-sm text-gray-500 mt-2 leading-relaxed">{confirmState.options.message}</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 bg-gray-50 border-t">
              <button
                onClick={() => handleConfirmResponse(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {confirmState.options.cancelLabel || "Cancel"}
              </button>
              <button
                onClick={() => handleConfirmResponse(true)}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg ${
                  confirmState.options.variant === "danger"
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-[#E53935] hover:bg-[#C62828]"
                }`}
              >
                {confirmState.options.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </UIContext.Provider>
  );
}
