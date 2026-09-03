export default function ImageLightbox({ src, alt, onClose }) {
  if (!src) return null;

  const handleDownload = async (e) => {
    e.stopPropagation();
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `image-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, '_blank');
    }
  };

  const handleCopy = async (e) => {
    e.stopPropagation();
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch {
      navigator.clipboard.writeText(src);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.9)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '20px',
          right: '24px',
          display: 'flex',
          gap: '12px',
          zIndex: 10000
        }}
        onClick={e => e.stopPropagation()}
      >
        <button onClick={handleCopy} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
          Copy
        </button>
        <button onClick={handleDownload} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>download</span>
          Download
        </button>
        <button onClick={onClose} className="btn btn-secondary btn-sm" style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}>
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
        </button>
      </div>
      <img
        src={src}
        alt={alt || 'Full preview'}
        onClick={e => e.stopPropagation()}
        style={{
          maxWidth: '90vw',
          maxHeight: '85vh',
          objectFit: 'contain',
          borderRadius: '8px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
        }}
      />
    </div>
  );
}
