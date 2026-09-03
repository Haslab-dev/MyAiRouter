export default function SlashCommandPopup({ commands, selectedIndex, onSelect }) {
  if (!commands.length) return null;

  return (
    <div style={{
      position: 'absolute',
      bottom: '100%',
      left: 0,
      right: 0,
      maxHeight: '260px',
      overflowY: 'auto',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: '10px',
      boxShadow: '0 -8px 32px rgba(0,0,0,0.3)',
      padding: '6px',
      marginBottom: '8px',
      zIndex: 100,
    }}>
      {commands.map((cmd, i) => (
        <div
          key={cmd.id}
          onClick={() => onSelect(cmd)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 10px',
            borderRadius: '6px',
            cursor: 'pointer',
            background: i === selectedIndex ? 'var(--nav-hover)' : 'transparent',
            transition: 'background 0.1s ease'
          }}
          onMouseEnter={(e) => {
            if (i !== selectedIndex) e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
          }}
          onMouseLeave={(e) => {
            if (i !== selectedIndex) e.currentTarget.style.background = 'transparent';
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>
            {cmd.icon}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
              {cmd.label}
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {cmd.description}
            </div>
          </div>
          {cmd.category && (
            <span style={{
              fontSize: '10px',
              padding: '2px 6px',
              borderRadius: '4px',
              background: 'rgba(255,255,255,0.05)',
              color: 'var(--text-muted)',
              flexShrink: 0
            }}>
              {cmd.category}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
