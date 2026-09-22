import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Lock, LogOut, User, ShieldCheck, Unlock } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'
import { Button, Field, Input, Modal } from '@/components/ui'

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { changePassword } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (next !== confirm) {
      setError('New passwords do not match')
      return
    }
    if (next.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setLoading(true)
    try {
      await changePassword(current, next)
      setSuccess(true)
      setTimeout(onClose, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Change Password"
      width="max-w-sm"
      footer={
        <>
          <Button size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" loading={loading} onClick={handleSubmit}>
            Update
          </Button>
        </>
      }
    >
      {success ? (
        <p className="py-4 text-center text-sm text-success">Password updated.</p>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Field label="Current password">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="New password">
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm new password">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          {error && <p className="text-xs text-danger">{error}</p>}
        </form>
      )}
    </Modal>
  )
}

export default function UserMenu() {
  const { status, logout, changePassword, refetch } = useAuth()
  const [open, setOpen] = useState(false)
  const [showChangePassword, setShowChangePassword] = useState(false)
  const [enablingAuth, setEnablingAuth] = useState(false)
  const [newAuthPw, setNewAuthPw] = useState('')
  const [confirmAuthPw, setConfirmAuthPw] = useState('')
  const [authError, setAuthError] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const disableAuth = async () => {
    setAuthBusy(true)
    try {
      await api.patch('/api/settings', { requireLogin: false })
      await refetch()
      setOpen(false)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to disable auth')
    } finally {
      setAuthBusy(false)
    }
  }

  const enableAuth = async () => {
    setAuthError('')
    if (newAuthPw.length < 6) {
      setAuthError('Password must be at least 6 characters')
      return
    }
    if (newAuthPw !== confirmAuthPw) {
      setAuthError('Passwords do not match')
      return
    }
    setAuthBusy(true)
    try {
      // No password set yet → seed it from the default, else re-key to the new one.
      await changePassword(status?.hasPassword ? newAuthPw : '123456789', newAuthPw).catch(async () => {
        // change-password requires the CURRENT password; when the user doesn't
        // know it we cannot re-key — surface instead of silently failing.
        throw new Error('Enter your current password first via Change password.')
      })
      await api.patch('/api/settings', { requireLogin: true })
      await refetch()
      setOpen(false)
      setEnablingAuth(false)
      setNewAuthPw('')
      setConfirmAuthPw('')
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Failed to enable auth')
    } finally {
      setAuthBusy(false)
    }
  }

  if (!status) return null

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-text transition-colors hover:bg-surface-2"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-accent bg-accent-subtle text-accent">
            <User size={13} />
          </span>
          <span className="text-xs font-medium">Operator</span>
          <ChevronDown size={13} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className="absolute right-0 top-full z-50 mt-1.5 w-52 rounded-lg border border-border bg-surface py-1 shadow-md">
            <div className="border-b border-border px-3 py-2.5">
              <div className="text-[13px] font-semibold">Operator</div>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted">
                {status.requireLogin ? (
                  <>
                    <Lock size={11} /> Auth enabled
                  </>
                ) : (
                  <>
                    <Unlock size={11} /> No auth
                  </>
                )}
              </div>
            </div>
            <div className="p-1">
              <button
                onClick={() => {
                  setOpen(false)
                  if (status.requireLogin) {
                    void disableAuth()
                  } else {
                    setEnablingAuth(true)
                  }
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                {status.requireLogin ? <Unlock size={14} /> : <ShieldCheck size={14} />}
                {status.requireLogin ? 'Disable password protection' : 'Enable password protection'}
              </button>
              <button
                onClick={() => {
                  setOpen(false)
                  setShowChangePassword(true)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <ShieldCheck size={14} />
                Change password
              </button>
              <button
                onClick={async () => {
                  setOpen(false)
                  await logout()
                  // requireLogin=false means there is no login page to land
                  // on; refresh so the operator sees the (open) dashboard in a
                  // clean state instead of expecting a login screen.
                  if (!status.requireLogin) window.location.reload()
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-danger transition-colors hover:bg-danger-subtle"
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}

      <Modal
        open={enablingAuth}
        onClose={() => {
          setEnablingAuth(false)
          setAuthError('')
          setNewAuthPw('')
          setConfirmAuthPw('')
        }}
        title="Enable password protection"
        subtitle="Require login to access this dashboard."
        width="max-w-sm"
        footer={
          <>
            <Button
              onClick={() => {
                setEnablingAuth(false)
                setAuthError('')
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={authBusy} onClick={enableAuth}>
              Protect dashboard
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void enableAuth()
          }}
        >
          <Field label="New password">
            <Input type="password" value={newAuthPw} onChange={(e) => setNewAuthPw(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password">
            <Input type="password" value={confirmAuthPw} onChange={(e) => setConfirmAuthPw(e.target.value)} autoComplete="new-password" />
          </Field>
          {authError && <p className="text-xs text-danger">{authError}</p>}
        </form>
      </Modal>
    </>
  )
}
