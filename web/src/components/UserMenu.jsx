import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

function ChangePasswordModal({ onClose }) {
  const { changePassword } = useAuth();
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
        background: '#121821',
        border: '1px solid #222B36',
        borderRadius: '16px',
        padding: '28px',
        width: '100%', maxWidth: '400px',
        margin: '0 16px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#00C8FF' }}>lock_reset</span>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#F3F6FA' }}>Change Password</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#9AA5B5', padding: 0 }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>

        {success ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '40px', color: '#2ECC71' }}>check_circle</span>
            <p style={{ color: '#2ECC71', fontWeight: 600, marginTop: '8px' }}>Password updated!</p>
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
                  color: '#9AA5B5', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px',
                }}>{label}</label>
                <input
                  id={id} type="password" value={val}
                  onChange={e => set(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 14px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid #222B36', borderRadius: '8px',
                    color: '#F3F6FA', fontSize: '13px', fontFamily: 'Inter, sans-serif',
                    outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
            ))}

            {error && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                color: '#FF5A67', fontSize: '12px', marginBottom: '12px',
                background: 'rgba(255,90,103,0.08)', padding: '8px 12px', borderRadius: '6px',
              }}>
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>error</span>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              <button type="submit" disabled={loading} style={{
                flex: 1, padding: '10px',
                background: 'linear-gradient(135deg, #00C8FF, #00a4d6)',
                border: 'none', borderRadius: '8px',
                color: '#fff', fontSize: '13px', fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}>
                {loading ? 'Updating...' : 'Update Password'}
              </button>
              <button type="button" onClick={onClose} style={{
                padding: '10px 16px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid #222B36', borderRadius: '8px',
                color: '#9AA5B5', fontSize: '13px', cursor: 'pointer',
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
  const [open, setOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const menuRef = useRef(null);

  // Close menu when clicking outside
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
        {/* Avatar button */}
        <button
          onClick={() => setOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            background: open ? 'rgba(0,200,255,0.08)' : 'transparent',
            border: `1px solid ${open ? 'rgba(0,200,255,0.2)' : 'transparent'}`,
            borderRadius: '8px',
            padding: '6px 10px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <div style={{
            width: '28px', height: '28px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #00C8FF33, #00C8FF11)',
            border: '1px solid rgba(0,200,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: '#00C8FF' }}>person</span>
          </div>
          <span style={{ fontSize: '12px', fontWeight: 500, color: '#F3F6FA' }}>Operator</span>
          <span className="material-symbols-outlined" style={{
            fontSize: '16px', color: '#9AA5B5',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}>expand_more</span>
        </button>

        {/* Dropdown */}
        {open && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: '220px',
            background: '#121821',
            border: '1px solid #222B36',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 8000,
            overflow: 'hidden',
            animation: 'fadeInDown 0.15s ease',
          }}>
            {/* User info header */}
            <div style={{
              padding: '16px 16px 12px',
              borderBottom: '1px solid #222B36',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '36px', height: '36px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, rgba(0,200,255,0.2), rgba(0,200,255,0.05))',
                  border: '1px solid rgba(0,200,255,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '20px', color: '#00C8FF' }}>person</span>
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '13px', color: '#F3F6FA' }}>Operator</div>
                  <div style={{ fontSize: '11px', color: '#4e5a6a', marginTop: '2px' }}>
                    {status.requireLogin ? '🔒 Auth Enabled' : '🔓 No Auth'}
                  </div>
                </div>
              </div>
            </div>

            {/* Menu items */}
            <div style={{ padding: '6px' }}>
              <button
                onClick={() => { setOpen(false); setShowChangePassword(true); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 10px',
                  background: 'transparent',
                  border: 'none', borderRadius: '8px',
                  color: '#9AA5B5', fontSize: '13px', cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s, color 0.15s',
                  fontFamily: 'Inter, sans-serif',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#F3F6FA'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9AA5B5'; }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '17px' }}>lock_reset</span>
                Change Password
              </button>

              <div style={{ height: '1px', background: '#222B36', margin: '4px 0' }} />

              <button
                onClick={async () => { setOpen(false); await logout(); }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '10px 10px',
                  background: 'transparent',
                  border: 'none', borderRadius: '8px',
                  color: '#FF5A67', fontSize: '13px', cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background 0.15s',
                  fontFamily: 'Inter, sans-serif',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,90,103,0.08)'}
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
