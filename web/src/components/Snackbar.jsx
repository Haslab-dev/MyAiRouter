import { useEffect } from 'react';
import { useSnackbar } from '../stores/snackbar';

const TYPE_CONFIG = {
  success: { bg: '#10b981', icon: 'check_circle' },
  error:   { bg: '#ef4444', icon: 'error' },
  info:    { bg: '#2563eb', icon: 'info' },
};

export default function Snackbar() {
  const { show, message, type, dismiss } = useSnackbar();
  const cfg = TYPE_CONFIG[type] || TYPE_CONFIG.info;

  // Pause auto-dismiss on hover
  if (!show) return null;

  return (
    <>
      <div
        onClick={dismiss}
        style={{
          position: 'fixed',
          bottom: '28px',
          right: '24px',
          padding: '12px 18px',
          borderRadius: '10px',
          background: cfg.bg,
          color: '#fff',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          zIndex: 99999,
          animation: 'sbSlideIn 0.28s cubic-bezier(.22,1,.36,1)',
          fontSize: '13.5px',
          fontWeight: 500,
          maxWidth: '380px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        title="Click to dismiss"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '19px', flexShrink: 0 }}>
          {cfg.icon}
        </span>
        <span style={{ flex: 1 }}>{message}</span>
        <span
          className="material-symbols-outlined"
          style={{ fontSize: '16px', opacity: 0.7, flexShrink: 0 }}
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
        >
          close
        </span>
      </div>
      <style>{`
        @keyframes sbSlideIn {
          from { transform: translateY(18px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </>
  );
}
