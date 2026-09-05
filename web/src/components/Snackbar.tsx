import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { useSnackbar } from '@/stores/snackbar'
import { cn } from '@/lib/cn'

const icons = {
  success: <CheckCircle2 size={14} className="text-success" />,
  info: <Info size={14} className="text-accent" />,
  error: <XCircle size={14} className="text-danger" />,
}

export default function Snackbar() {
  const { show, message, type, dismiss } = useSnackbar()
  if (!show) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] animate-[slide-up_150ms_ease-out]">
      <button
        onClick={dismiss}
        className={cn(
          'flex max-w-sm items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-text shadow-sm',
        )}
      >
        {icons[type]}
        <span className="text-left">{message}</span>
      </button>
    </div>
  )
}
