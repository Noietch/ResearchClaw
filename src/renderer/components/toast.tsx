import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

// ─── Types ───────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType, action?: ToastAction) => void;
  success: (message: string, action?: ToastAction) => void;
  error: (message: string, action?: ToastAction) => void;
  info: (message: string, action?: ToastAction) => void;
  warning: (message: string, action?: ToastAction) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info', action?: ToastAction) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [...prev, { id, message, type, action }]);
      // Auto remove after 4 seconds (6 seconds if action button present)
      setTimeout(() => removeToast(id), action ? 6000 : 4000);
    },
    [removeToast],
  );

  const success = useCallback(
    (message: string, action?: ToastAction) => toast(message, 'success', action),
    [toast],
  );
  const error = useCallback(
    (message: string, action?: ToastAction) => toast(message, 'error', action),
    [toast],
  );
  const info = useCallback(
    (message: string, action?: ToastAction) => toast(message, 'info', action),
    [toast],
  );
  const warning = useCallback(
    (message: string, action?: ToastAction) => toast(message, 'warning', action),
    [toast],
  );

  return (
    <ToastContext.Provider value={{ toast, success, error, info, warning }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

// ─── Toast Container ─────────────────────────────────────────────────────────

function ToastContainer({
  toasts,
  removeToast,
}: {
  toasts: Toast[];
  removeToast: (id: string) => void;
}) {
  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => removeToast(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Toast Item ──────────────────────────────────────────────────────────────

const toastStyles: Record<
  ToastType,
  { icon: typeof CheckCircle; bg: string; border: string; iconColor: string }
> = {
  success: {
    icon: CheckCircle,
    bg: 'bg-green-50',
    border: 'border-green-200',
    iconColor: 'text-green-600',
  },
  error: {
    icon: AlertCircle,
    bg: 'bg-red-50',
    border: 'border-red-200',
    iconColor: 'text-red-600',
  },
  info: { icon: Info, bg: 'bg-blue-50', border: 'border-blue-200', iconColor: 'text-blue-600' },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    iconColor: 'text-yellow-600',
  },
};

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const style = toastStyles[toast.type];
  const Icon = style.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className={clsx(
        'flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg',
        style.bg,
        style.border,
      )}
    >
      <Icon size={16} className={style.iconColor} />
      <p className="text-sm font-medium text-notion-text">{toast.message}</p>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.onClick();
            onClose();
          }}
          className="ml-1 flex-shrink-0 rounded-md bg-black/5 px-2 py-0.5 text-xs font-medium text-notion-text transition-colors hover:bg-black/10"
        >
          {toast.action.label}
        </button>
      )}
      <button
        onClick={onClose}
        className="ml-2 rounded p-0.5 text-notion-text-tertiary hover:bg-black/5 hover:text-notion-text"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}
