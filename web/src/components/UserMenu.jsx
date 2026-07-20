import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';

function ChangePasswordModal({ onClose }) {
  const { changePassword } = useAuth();
  const { theme } = useTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) { setError('New passwords do not match'); return; }
    if (next.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await changePassword(current, next);
      setSuccess(true);
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9000,
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border-color)',
        borderRadius: '16px',
        padding: '28px',
        width: '100%', maxWidth: '400px',
        margin: '0 16px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--color-primary)' }}>lock_reset</span>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)' }}>Change Password</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '40px', color: 'var(--color-success)' }}>check_circle</span>
            <p style={{ color: 'var(--color-success)', fontWeight: 600, marginTop: '8px' }}>Password updated!</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {[
              { label: 'Current Password', val: current, set: setCurrent, id: 'cp-current' },
              { label: 'New Password', val: next, set: setNext, id: 'cp-new' },
              { label: 'Confirm New Password', val: confirm, set: setConfirm, id: 'cp-confirm' },
            ].map(({ label, val, set, id }) => (
              <div key={id} style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'block', fontSize: '11px', fontWeight: 600,
                  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px',
                }}>{label}</label>
                <input
                  id={id} type="password" value={val}
                  onChange={e => set(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px',
                    background: 'var(--input-bg)',
                    border: '1px solid var(--border-color)', borderRadius: '8px',
                    color: 'var(--text-main)', fontSize: '13px', fontFamily: 'Inter, sans-serif',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}

            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                color: 'var(--color-danger)', fontSize: '12px', marginBottom: '12px',
                background: 'rgba(220, 38, 38, 0.08)', padding: '8px 12px', borderRadius: '6px',
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>error</span>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              <button type="submit" disabled={loading} style={{
                flex: 1, padding: '10px',
                background: `linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))`,
                border: 'none', borderRadius: '8px',
                color: '#fff', fontSize: '13px', fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}>
                {loading ? 'Updating...' : 'Update Password'}
              </button>
              <button type="button" onClick={onClose} style={{
                padding: '10px 16px',
                background: 'var(--input-bg)',
                border: '1px solid var(--border-color)', borderRadius: '8px',
                color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function UserMenu() {
  const { status, logout } = useAuth();
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!status) return null;

  return (
    <>
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: open ? 'var(--nav-active-bg)' : 'transparent',
            border: `1px solid ${open ? 'var(--nav-active-border)' : 'transparent'}`,
            borderRadius: '8px',
            padding: '6px 10px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            width: '28px', height: '28px', borderRadius: '50%',
            background: `linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))`,
            opacity: 0.2,
            border: '1px solid var(--color-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>person</span>
          </div>
          <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-main)' }}>Operator</span>
          <span className="material-symbols-outlined" style={{
            fontSize: '16px', color: 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}>expand_more</span>
        </button>

        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: '220px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            zIndex: 8000,
            overflow: 'hidden',
            animation: 'fadeInDown 0.15s ease',
          }}>
            <div style={{
              padding: '16px 16px 12px',
              borderBottom: '1px solid var(--border-color)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: `linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))`,
                  opacity: 0.2,
                  border: '1px solid var(--color-primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--color-primary)' }}>person</span>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-main)' }}>Operator</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-subtle)', marginTop: '2px' }}>
                    {status.requireLogin ? '🔒 Auth Enabled' : '🔓 No Auth'}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ padding: '6px' }}>
              <button
                onClick={() => { setOpen(false); setShowChangePassword(true); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 10px',
                  background: 'transparent',
                  border: 'none', borderRadius: '8px',
                  color: 'var(--text-muted)', fontSize: '13px', cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s, color 0.15s',
                  fontFamily: 'Inter, sans-serif',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--nav-hover)'; e.currentTarget.style.color = 'var(--text-main)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>lock_reset</span>
                Change Password
              </button>

              <div style={{ height: '1px', background: 'var(--border-color)', margin: '4px 0' }} />

              <button
                onClick={async () => { setOpen(false); await logout(); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 10px',
                  background: 'transparent',
                  border: 'none', borderRadius: '8px',
                  color: 'var(--color-danger)', fontSize: '13px', cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                  fontFamily: 'Inter, sans-serif',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--glow-danger)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>logout</span>
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>

      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}

      <style>{`
        @keyframes fadeInDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
