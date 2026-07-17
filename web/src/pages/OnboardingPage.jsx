import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'password', label: 'Security' },
  { id: 'provider', label: 'Connect' },
  { id: 'done', label: 'Launch' },
];

/* ────────── Step components ────────── */

function StepWelcome({ onNext }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: '72px', height: '72px',
        background: 'linear-gradient(135deg, #00C8FF, #0088bb)',
        borderRadius: '20px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 24px',
        boxShadow: '0 0 60px rgba(0,200,255,0.35)',
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: '36px', color: '#fff' }}>router</span>
      </div>
      <h1 style={{ fontSize: '28px', fontWeight: 800, color: '#F3F6FA', letterSpacing: '-0.5px', marginBottom: '12px' }}>
        Welcome to myAiRouter
      </h1>
      <p style={{ fontSize: '14px', color: '#9AA5B5', lineHeight: 1.7, maxWidth: '360px', margin: '0 auto 32px' }}>
        Your self-hosted AI gateway. Route requests across multiple providers, manage keys, compress tokens, and monitor traffic — all from one place.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '36px', maxWidth: '440px', margin: '0 auto 36px' }}>
        {[
          { icon: 'alt_route', label: 'Smart Routing', desc: 'Route across providers' },
          { icon: 'compress', label: 'Token Saving', desc: 'Reduce costs up to 40%' },
          { icon: 'monitoring', label: 'Analytics', desc: 'Full traffic visibility' },
        ].map(f => (
          <div key={f.label} style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid #222B36',
            borderRadius: '12px',
            padding: '14px 10px',
            textAlign: 'center',
          }}>
            <span className="material-symbols-outlined" style={{ fontSize: '22px', color: '#00C8FF', display: 'block', marginBottom: '6px' }}>{f.icon}</span>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#F3F6FA', marginBottom: '2px' }}>{f.label}</div>
            <div style={{ fontSize: '10px', color: '#9AA5B5' }}>{f.desc}</div>
          </div>
        ))}
      </div>

      <button onClick={onNext} style={btnPrimary}>
        Get Started
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_forward</span>
      </button>
    </div>
  );
}

function StepPassword({ onNext, onSkip }) {
  const { login, changePassword } = useAuth();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [enableAuth, setEnableAuth] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const handleContinue = async () => {
    setError('');
    if (enableAuth) {
      if (pw.length < 6) { setError('Password must be at least 6 characters'); return; }
      if (pw !== confirm) { setError('Passwords do not match'); return; }
      setLoading(true);
      try {
        // change-password only needs current password proof (no session required)
        await changePassword('123456789', pw);
        // Enable requireLogin in settings
        await fetch('/api/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requireLogin: true }),
        });
        // Now login with the new password to get a valid session
        await login(pw);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
        return;
      }
    }
    setLoading(false);
    onNext();
  };

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <div style={iconCircle('#F5B041')}>
          <span className="material-symbols-outlined" style={{ fontSize: '26px', color: '#fff' }}>security</span>
        </div>
        <h2 style={stepTitle}>Secure Your Gateway</h2>
        <p style={stepDesc}>Optionally protect the dashboard with a password. You can always change this later in settings.</p>
      </div>

      {/* Toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(255,255,255,0.03)', border: '1px solid #222B36',
        borderRadius: '10px', padding: '14px 16px', marginBottom: '20px', cursor: 'pointer',
      }} onClick={() => setEnableAuth(v => !v)}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '13px', color: '#F3F6FA' }}>Enable password protection</div>
          <div style={{ fontSize: '11px', color: '#9AA5B5', marginTop: '2px' }}>Require login to access the dashboard</div>
        </div>
        <label className="switch" style={{ pointerEvents: 'none' }}>
          <input type="checkbox" checked={enableAuth} onChange={() => {}} />
          <span className="slider"></span>
        </label>
      </div>

      {enableAuth && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
          <div>
            <label style={fieldLabel}>New Password</label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={pw} onChange={e => setPw(e.target.value)}
                placeholder="At least 6 characters"
                style={inputStyle(!!error)}
              />
              <button type="button" onClick={() => setShowPw(v => !v)} style={eyeBtn}>
                <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                  {showPw ? 'visibility_off' : 'visibility'}
                </span>
              </button>
            </div>
          </div>
          <div>
            <label style={fieldLabel}>Confirm Password</label>
            <input
              type="password"
              value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Repeat password"
              style={inputStyle(!!error)}
            />
          </div>
          {error && (
            <div style={errorBox}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>error</span>
              {error}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={handleContinue} disabled={loading} style={{ ...btnPrimary, flex: 1 }}>
          {loading ? 'Saving...' : 'Continue'}
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>arrow_forward</span>
        </button>
        {!enableAuth && (
          <button onClick={onSkip} style={btnSecondary}>Skip</button>
        )}
      </div>
    </div>
  );
}

function StepProvider({ onNext }) {
  const [nodeType, setNodeType] = useState('');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState(false);

  const PROVIDERS = [
    { id: 'openai', label: 'OpenAI', color: '#10a37f', icon: 'smart_toy', isCore: true },
    { id: 'anthropic', label: 'Anthropic', color: '#cc785c', icon: 'psychology', isCore: true },
    { id: 'gemini', label: 'Gemini', color: '#4285F4', icon: 'auto_awesome', isCore: true },
    { id: 'openai-compatible', label: 'OpenAI Compatible', color: '#6366f1', icon: 'api', isCore: false },
  ];

  const selected = PROVIDERS.find(p => p.id === nodeType);

  const handleConnect = async () => {
    if (!nodeType || !apiKey) { setError('Select a provider and enter an API key'); return; }
    setLoading(true);
    setError('');
    try {
      const body = {
        provider: nodeType,
        name: name || `${selected.label} Key`,
        data: { apiKey, baseUrl: url || undefined },
        isActive: true,
        priority: 1,
      };
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to connect provider');
      onNext();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={{ textAlign: 'center', marginBottom: '28px' }}>
        <div style={iconCircle('#2ECC71')}>
          <span className="material-symbols-outlined" style={{ fontSize: '26px', color: '#fff' }}>dns</span>
        </div>
        <h2 style={stepTitle}>Connect Your First Provider</h2>
        <p style={stepDesc}>Add an AI provider API key to start routing requests. You can add more later.</p>
      </div>

      {/* Provider selector */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px' }}>
        {PROVIDERS.map(p => (
          <button
            key={p.id}
            onClick={() => setNodeType(p.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '12px 14px',
              background: nodeType === p.id ? `${p.color}20` : 'rgba(255,255,255,0.03)',
              border: `1px solid ${nodeType === p.id ? p.color : '#222B36'}`,
              borderRadius: '10px', cursor: 'pointer',
              transition: 'all 0.15s',
              fontFamily: 'Inter, sans-serif',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px', color: nodeType === p.id ? p.color : '#9AA5B5' }}>{p.icon}</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: nodeType === p.id ? '#F3F6FA' : '#9AA5B5' }}>{p.label}</span>
          </button>
        ))}
      </div>

      {nodeType && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
          {!selected?.isCore && (
            <div>
              <label style={fieldLabel}>Base URL</label>
              <input
                type="text" value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://api.example.com/v1"
                style={inputStyle(false)}
              />
            </div>
          )}
          <div>
            <label style={fieldLabel}>API Key</label>
            <input
              type="password" value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-..."
              style={inputStyle(!!error)}
            />
          </div>
          {error && <div style={errorBox}><span className="material-symbols-outlined" style={{ fontSize: '14px' }}>error</span>{error}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: '10px' }}>
        <button onClick={handleConnect} disabled={loading || !nodeType} style={{ ...btnPrimary, flex: 1 }}>
          {loading ? 'Connecting...' : 'Connect Provider'}
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>link</span>
        </button>
        <button onClick={onNext} style={btnSecondary}>Skip</button>
      </div>
    </div>
  );
}

function StepDone({ onFinish }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{
        width: '72px', height: '72px',
        background: 'linear-gradient(135deg, #2ECC71, #1aab5f)',
        borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        margin: '0 auto 24px',
        boxShadow: '0 0 50px rgba(46,204,113,0.4)',
        animation: 'pulseGreen 2s ease-in-out infinite',
      }}>
        <span className="material-symbols-outlined" style={{ fontSize: '36px', color: '#fff' }}>check</span>
      </div>
      <h2 style={{ fontSize: '26px', fontWeight: 800, color: '#F3F6FA', letterSpacing: '-0.5px', marginBottom: '12px' }}>
        You're all set!
      </h2>
      <p style={{ fontSize: '14px', color: '#9AA5B5', lineHeight: 1.7, marginBottom: '32px' }}>
        Your gateway is ready. Head to the dashboard to start routing requests, monitor traffic, and manage your AI providers.
      </p>
      <button onClick={onFinish} style={{ ...btnPrimary, margin: '0 auto', minWidth: '200px' }}>
        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>rocket_launch</span>
        Open Dashboard
      </button>
      <style>{`
        @keyframes pulseGreen {
          0%, 100% { box-shadow: 0 0 50px rgba(46,204,113,0.4); }
          50% { box-shadow: 0 0 80px rgba(46,204,113,0.6); }
        }
      `}</style>
    </div>
  );
}

/* ────────── Shared styles ────────── */
const btnPrimary = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
  padding: '13px 24px',
  background: 'linear-gradient(135deg, #00C8FF, #00a4d6)',
  border: 'none', borderRadius: '10px',
  color: '#fff', fontSize: '14px', fontWeight: 700,
  cursor: 'pointer', fontFamily: 'Inter, sans-serif',
  boxShadow: '0 4px 20px rgba(0,200,255,0.25)',
  transition: 'all 0.2s',
};
const btnSecondary = {
  padding: '13px 20px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid #222B36', borderRadius: '10px',
  color: '#9AA5B5', fontSize: '14px', cursor: 'pointer',
  fontFamily: 'Inter, sans-serif',
};
const iconCircle = (color) => ({
  width: '56px', height: '56px',
  background: `linear-gradient(135deg, ${color}, ${color}bb)`,
  borderRadius: '16px',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  margin: '0 auto 16px',
  boxShadow: `0 0 40px ${color}55`,
});
const stepTitle = { fontSize: '22px', fontWeight: 800, color: '#F3F6FA', letterSpacing: '-0.3px', marginBottom: '8px' };
const stepDesc = { fontSize: '13px', color: '#9AA5B5', lineHeight: 1.7, maxWidth: '340px', margin: '0 auto' };
const fieldLabel = { display: 'block', fontSize: '11px', fontWeight: 600, color: '#9AA5B5', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '6px' };
const inputStyle = (hasError) => ({
  width: '100%', padding: '11px 14px',
  background: 'rgba(255,255,255,0.04)',
  border: `1px solid ${hasError ? '#FF5A67' : '#222B36'}`,
  borderRadius: '8px',
  color: '#F3F6FA', fontSize: '13px', fontFamily: 'Inter, sans-serif',
  outline: 'none', boxSizing: 'border-box',
});
const eyeBtn = { position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9AA5B5', padding: 0 };
const errorBox = { display: 'flex', alignItems: 'center', gap: '6px', color: '#FF5A67', fontSize: '12px', background: 'rgba(255,90,103,0.08)', padding: '8px 12px', borderRadius: '6px' };

/* ────────── Main Onboarding component ────────── */
export default function OnboardingPage() {
  const { completeOnboarding } = useAuth();
  const [step, setStep] = useState(0);

  const next = () => setStep(s => Math.min(s + 1, STEPS.length - 1));
  const finish = () => completeOnboarding();

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
      {/* Ambient glows */}
      <div style={{ position: 'absolute', top: '-15%', left: '50%', transform: 'translateX(-50%)', width: '900px', height: '450px', background: 'radial-gradient(ellipse, rgba(0,200,255,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '-10%', right: '0', width: '500px', height: '500px', background: 'radial-gradient(ellipse, rgba(46,204,113,0.04) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{ width: '100%', maxWidth: '520px', padding: '0 20px', position: 'relative', zIndex: 1 }}>
        {/* Step progress indicator */}
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0', marginBottom: '40px' }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                width: '28px', height: '28px', borderRadius: '50%',
                background: i < step ? '#2ECC71' : i === step ? '#00C8FF' : 'rgba(255,255,255,0.06)',
                border: `2px solid ${i < step ? '#2ECC71' : i === step ? '#00C8FF' : '#222B36'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', fontWeight: 700,
                color: i <= step ? '#fff' : '#4e5a6a',
                transition: 'all 0.3s',
                flexShrink: 0,
              }}>
                {i < step
                  ? <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>check</span>
                  : i + 1}
              </div>
              <div style={{ fontSize: '11px', color: i === step ? '#F3F6FA' : '#4e5a6a', fontWeight: i === step ? 600 : 400, margin: '0 8px', whiteSpace: 'nowrap' }}>
                {s.label}
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ width: '32px', height: '1px', background: i < step ? '#2ECC71' : '#222B36', transition: 'background 0.3s', marginRight: '8px' }} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div style={{
          background: '#121821',
          border: '1px solid #222B36',
          borderRadius: '20px',
          padding: '36px',
          boxShadow: '0 12px 60px rgba(0,0,0,0.5)',
        }}>
          {step === 0 && <StepWelcome onNext={next} />}
          {step === 1 && <StepPassword onNext={next} onSkip={next} />}
          {step === 2 && <StepProvider onNext={next} />}
          {step === 3 && <StepDone onFinish={finish} />}
        </div>
      </div>
    </div>
  );
}
