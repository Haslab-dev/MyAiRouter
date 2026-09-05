import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Loader2, X } from 'lucide-react'

/*
 * UI primitives for the myAiRouter dashboard.
 *
 * Design contract: flat surfaces, 1px borders, ONE blue accent, semantic
 * colors only for status. No gradients, no glow, no backdrop blur.
 */

/* ---------------------------------- Button --------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-text border border-border hover:border-border-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-muted border border-transparent hover:bg-surface-2 hover:text-text',
  danger: 'bg-danger-subtle text-danger border border-transparent hover:brightness-95',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
}

export function Button({ variant = 'secondary', size = 'md', loading, className = '', children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-colors select-none disabled:opacity-50 disabled:pointer-events-none ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" />}
      {children}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
}

export function IconButton({ label, active, className = '', children, ...rest }: IconButtonProps) {
  return (
    <button
      title={label}
      aria-label={label}
      className={`inline-flex items-center justify-center h-8 w-8 rounded-md border transition-colors ${
        active
          ? 'border-accent text-accent bg-accent-subtle'
          : 'border-transparent text-muted hover:bg-surface-2 hover:text-text'
      } ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ----------------------------------- Card ---------------------------------- */

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean
  interactive?: boolean
}

export function Card({ padded = true, interactive, className = '', children, ...rest }: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-lg ${padded ? 'p-4' : ''} ${
        interactive ? 'cursor-pointer hover:border-border-strong transition-colors' : ''
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/* ---------------------------------- Inputs --------------------------------- */

const fieldClass =
  'w-full bg-bg border border-border rounded-md px-3 text-sm text-text placeholder:text-subtle outline-none transition-colors focus:border-accent disabled:opacity-50'

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldClass} h-9 ${className}`} {...rest} />
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} py-2 min-h-20 resize-y ${className}`} {...rest} />
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${fieldClass} h-9 appearance-none pr-8 ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-muted mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-subtle mt-1">{hint}</span>}
    </label>
  )
}

/* ---------------------------------- Badge ---------------------------------- */

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

const badgeTones: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted border-border',
  accent: 'bg-accent-subtle text-accent border-transparent',
  success: 'bg-success-subtle text-success border-transparent',
  warning: 'bg-warning-subtle text-warning border-transparent',
  danger: 'bg-danger-subtle text-danger border-transparent',
}

export function Badge({ tone = 'neutral', className = '', children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border ${badgeTones[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function StatusDot({ tone = 'neutral', pulse }: { tone?: BadgeTone; pulse?: boolean }) {
  const colors: Record<BadgeTone, string> = {
    neutral: 'bg-subtle',
    accent: 'bg-accent',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  }
  return <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${colors[tone]} ${pulse ? 'animate-pulse' : ''}`} />
}

/* ---------------------------------- Toggle --------------------------------- */

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border transition-colors ${
        checked ? 'bg-accent border-accent' : 'bg-surface-2 border-border'
      }`}
    >
      <span
        className="absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: checked ? 'translateX(16px)' : 'translateX(0)' }}
      />
    </button>
  )
}

/* ---------------------------------- Modal ---------------------------------- */

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: string
  width?: string
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ open, onClose, title, subtitle, width = 'max-w-lg', children, footer }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-[fade-in_120ms_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className={`w-full ${width} max-h-[85vh] flex flex-col bg-surface border border-border rounded-lg animate-[slide-up_150ms_ease-out]`}
      >
        <div className="flex items-start justify-between gap-4 px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-text">{title}</h2>
            {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </div>
        <div className="px-4 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">{footer}</div>}
      </div>
    </div>
  )
}

/* ------------------------------- Confirmation ------------------------------ */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-sm"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{message}</p>
    </Modal>
  )
}

/* --------------------------------- Feedback -------------------------------- */

export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin text-muted ${className}`} />
}

export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      {icon && <div className="text-subtle mb-3">{icon}</div>}
      <p className="text-sm font-medium text-text">{title}</p>
      {hint && <p className="text-xs text-muted mt-1 max-w-xs">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-surface-2 rounded-md ${className}`} />
}

/* ----------------------------------- Tabs ---------------------------------- */

interface TabsContextValue {
  active: string
  setActive: (id: string) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

export function Tabs({ tabs, active, onChange }: { tabs: Array<{ id: string; label: ReactNode }>; active: string; onChange: (id: string) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 bg-surface-2 border border-border rounded-md" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`px-2.5 h-7 text-xs font-medium rounded transition-colors ${
            active === t.id ? 'bg-surface text-text border border-border' : 'text-muted hover:text-text'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('useTabs must be used within Tabs provider')
  return ctx
}

/* ---------------------------------- Table ---------------------------------- */

export function Table({ headers, children, className = '' }: { headers: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <th key={i} className="text-left text-[11px] font-medium text-subtle uppercase tracking-wide px-3 py-2 whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ className = '', children, colSpan }: { className?: string; children: ReactNode; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={`px-3 py-2.5 border-b border-border/60 align-middle ${className}`}>
      {children}
    </td>
  )
}

/* -------------------------------- Page shell ------------------------------- */

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-6xl px-6 py-6">{children}</div>
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-text">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[13px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Small key/value readout used in stat cards. */
export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: BadgeTone }) {
  const valueTone =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-text'
  return (
    <Card className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-subtle">{label}</div>
      <div className={`tnum mt-1.5 truncate text-xl font-semibold ${valueTone}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-subtle">{hint}</div>}
    </Card>
  )
}
