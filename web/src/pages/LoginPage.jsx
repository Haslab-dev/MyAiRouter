import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0B0F14',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Ambient glow blobs */}
      <div style={{
        position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)',
        width: '800px', height: '400px',
        background: 'radial-gradient(ellipse, rgba(0,200,255,0.06) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-10%', right: '-10%',
        width: '400px', height: '400px',
        background: 'radial-gradient(ellipse, rgba(46,204,113,0.04) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        width: '100%',
        maxWidth: '420px',
        padding: '0 20px',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            width: '56px', height: '56px',
            background: 'linear-gradient(135deg, #00C8FF, #0088bb)',
            borderRadius: '14px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 0 40px rgba(0,200,255,0.3)',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '28px', color: '#fff' }}>router</span>
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#F3F6FA', letterSpacing: '-0.5px' }}>myAiRouter</h1>
          <p style={{ fontSize: '13px', color: '#9AA5B5', marginTop: '6px' }}>Enter your password to access the gateway</p>
        </div>

        {/* Card */}
        <div style={{
          background: '#121821',
          border: '1px solid #222B36',
          borderRadius: '16px',
          padding: '32px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.4)',
        }}>
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: '20px' }}>
              <label style={{
                display: 'block',
                fontSize: '11px', fontWeight: 600, color: '#9AA5B5',
                textTransform: 'uppercase', letterSpacing: '0.8px',
                marginBottom: '8px',
              }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter gateway password"
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '12px 44px 12px 14px',
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${error ? '#FF5A67' : '#222B36'}`,
                    borderRadius: '8px',
                    color: '#F3F6FA',
                    fontSize: '14px',
                    fontFamily: 'Inter, sans-serif',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                    boxSizing: 'border-box',
                  }}
                  onFocus={e => e.target.style.borderColor = error ? '#FF5A67' : '#00C8FF'}
                  onBlur={e => e.target.style.borderColor = error ? '#FF5A67' : '#222B36'}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  style={{
                    position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: '#9AA5B5', padding: 0,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                    {showPw ? 'visibility_off' : 'visibility'}
                  </span>
                </button>
              </div>
              {error && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', color: '#FF5A67', fontSize: '12px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>error</span>
                  {error}
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading || !password}
              style={{
                width: '100%',
                padding: '13px',
                background: loading || !password
                  ? 'rgba(0,200,255,0.3)'
                  : 'linear-gradient(135deg, #00C8FF, #00a4d6)',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '14px',
                fontWeight: 700,
                cursor: loading || !password ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                fontFamily: 'Inter, sans-serif',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: loading || !password ? 'none' : '0 4px 16px rgba(0,200,255,0.25)',
              }}
            >
              {loading ? (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px', animation: 'spin 1s linear infinite' }}>progress_activity</span>
                  Authenticating...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>lock_open</span>
                  Unlock Gateway
                </>
              )}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', fontSize: '11px', color: '#4e5a6a', marginTop: '20px' }}>
          Default password: <code style={{ fontFamily: 'JetBrains Mono, monospace', color: '#9AA5B5' }}>123456789</code>
        </p>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
