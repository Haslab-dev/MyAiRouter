import { useState, useEffect, useRef, useMemo } from 'react';
import ProviderIcon from '../components/ProviderIcon';

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function groupSessions(sessions) {
  const groups = {
    Today: [],
    Yesterday: [],
    'Previous 7 Days': [],
    Older: []
  };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const weekStart = todayStart - 7 * 86400000;

  sessions.forEach(s => {
    const time = new Date(s.updatedAt || s.createdAt || Date.now()).getTime();
    if (time >= todayStart) {
      groups.Today.push(s);
    } else if (time >= yesterdayStart) {
      groups.Yesterday.push(s);
    } else if (time >= weekStart) {
      groups['Previous 7 Days'].push(s);
    } else {
      groups.Older.push(s);
    }
  });

  return groups;
}

function ImageLightbox({ src, alt, onClose }) {
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
      alert('Image copied to clipboard!');
    } catch {
      navigator.clipboard.writeText(src);
      alert('Image URL copied to clipboard!');
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
        <button
          onClick={handleCopy}
          className="btn btn-secondary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.12)', color: '#fff' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
          Copy Image
        </button>
        <button
          onClick={handleDownload}
          className="btn btn-secondary btn-sm"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.12)', color: '#fff' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>download</span>
          Download
        </button>
        <button
          onClick={onClose}
          className="btn btn-secondary btn-sm"
          style={{ background: 'rgba(255,255,255,0.12)', color: '#fff' }}
        >
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

function RenderMarkdown({ content, onImageClick }) {
  if (!content) return null;

  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{ lineHeight: '1.6', fontSize: '14px' }}>
      {parts.map((part, idx) => {
        if (part.startsWith('```')) {
          const firstLineEnd = part.indexOf('\n');
          let lang = 'text';
          let code = part;
          if (firstLineEnd !== -1) {
            lang = part.slice(3, firstLineEnd).trim() || 'text';
            code = part.slice(firstLineEnd + 1, -3);
          } else {
            code = part.slice(3, -3);
          }

          const copyToClipboard = () => {
            navigator.clipboard.writeText(code);
          };

          return (
            <div
              key={idx}
              style={{
                margin: '12px 0',
                borderRadius: '8px',
                overflow: 'hidden',
                border: '1px solid var(--border-color)',
                background: '#161b22'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 12px',
                  background: '#21262d',
                  fontSize: '11px',
                  color: '#8b949e',
                  fontFamily: 'var(--font-mono)'
                }}
              >
                <span>{lang}</span>
                <button
                  onClick={copyToClipboard}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#8b949e',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '11px'
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>content_copy</span>
                  Copy
                </button>
              </div>
              <pre
                style={{
                  padding: '12px 16px',
                  margin: 0,
                  fontSize: '13px',
                  fontFamily: 'var(--font-mono)',
                  color: '#c9d1d9',
                  overflowX: 'auto',
                  lineHeight: '1.5'
                }}
              >
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        const imageRegex = /!\[(.*?)\]\((https?:\/\/[^\s)]+|data:image\/[^\s)]+)\)/g;
        const subParts = [];
        let lastIdx = 0;
        let match;

        while ((match = imageRegex.exec(part)) !== null) {
          if (match.index > lastIdx) {
            subParts.push({ type: 'text', content: part.slice(lastIdx, match.index) });
          }
          subParts.push({ type: 'image', alt: match[1], url: match[2] });
          lastIdx = match.index + match[0].length;
        }
        if (lastIdx < part.length) {
          subParts.push({ type: 'text', content: part.slice(lastIdx) });
        }

        if (subParts.length > 1 || (subParts.length === 1 && subParts[0].type === 'image')) {
          return (
            <div key={idx}>
              {subParts.map((sp, sIdx) => {
                if (sp.type === 'image') {
                  return (
                    <div
                      key={sIdx}
                      style={{
                        position: 'relative',
                        margin: '12px 0',
                        display: 'inline-block',
                        borderRadius: '10px',
                        overflow: 'hidden',
                        border: '1px solid var(--border-color)',
                        background: 'var(--bg-card)'
                      }}
                      className="chat-image-container"
                    >
                      <img
                        src={sp.url}
                        alt={sp.alt || 'Generated or attached'}
                        onClick={() => onImageClick && onImageClick(sp.url, sp.alt)}
                        style={{
                          maxWidth: '100%',
                          maxHeight: '400px',
                          display: 'block',
                          cursor: 'pointer',
                          objectFit: 'cover'
                        }}
                      />
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: 'rgba(0,0,0,0.6)',
                          backdropFilter: 'blur(4px)',
                          fontSize: '11px',
                          color: '#e5e7eb'
                        }}
                      >
                        <span style={{ maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {sp.alt || 'Image'}
                        </span>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={() => onImageClick && onImageClick(sp.url, sp.alt)}
                            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            title="Fullscreen"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>zoom_in</span>
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch(sp.url);
                                const blob = await res.blob();
                                await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                                alert('Image copied to clipboard!');
                              } catch {
                                navigator.clipboard.writeText(sp.url);
                                alert('Image link copied!');
                              }
                            }}
                            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            title="Copy Image"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>content_copy</span>
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch(sp.url);
                                const blob = await res.blob();
                                const u = URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = u;
                                a.download = `image-${Date.now()}.png`;
                                a.click();
                                URL.revokeObjectURL(u);
                              } catch {
                                window.open(sp.url, '_blank');
                              }
                            }}
                            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                            title="Download Image"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>download</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <span key={sIdx} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {sp.content}
                  </span>
                );
              })}
            </div>
          );
        }

        return (
          <span key={idx} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {part}
          </span>
        );
      })}
    </div>
  );
}

function ThinkingSection({ reasoning, isThinking, durationSec }) {
  const [isOpen, setIsOpen] = useState(isThinking);

  useEffect(() => {
    if (isThinking) {
      setIsOpen(true);
    }
  }, [isThinking]);

  if (!reasoning && !isThinking) return null;

  return (
    <div
      style={{
        margin: '8px 0 14px 0',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
        background: 'rgba(255, 255, 255, 0.02)',
        overflow: 'hidden'
      }}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          fontSize: '12px',
          cursor: 'pointer',
          fontFamily: 'var(--font-mono)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isThinking ? (
            <span className="material-symbols-outlined spin" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>
              progress_activity
            </span>
          ) : (
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>
              psychology
            </span>
          )}
          <span style={{ fontWeight: 600, color: isThinking ? 'var(--color-primary)' : 'var(--text-muted)' }}>
            {isThinking ? 'Thinking...' : `Thought for ${durationSec ? durationSec.toFixed(1) : 0}s`}
          </span>
        </div>
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: '16px',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease'
          }}
        >
          expand_more
        </span>
      </button>

      {isOpen && (
        <div
          style={{
            padding: '10px 14px',
            borderTop: '1px solid var(--border-color)',
            fontSize: '12.5px',
            lineHeight: '1.55',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: 'rgba(0, 0, 0, 0.15)',
            maxHeight: '320px',
            overflowY: 'auto'
          }}
        >
          {reasoning || (isThinking ? 'Analyzing context and formulating response...' : '')}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [systemApiKey, setSystemApiKey] = useState('');

  const [chatMode, setChatMode] = useState('chat');

  // Sessions
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingTitleId, setEditingTitleId] = useState(null);
  const [editTitleValue, setEditTitleValue] = useState('');

  // Messages & Stream
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [errorToast, setErrorToast] = useState('');

  // Lightbox
  const [lightboxImg, setLightboxImg] = useState(null);

  // Refs
  const abortControllerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  useEffect(() => {
    async function init() {
      const key = await fetchSystemApiKey();
      await fetchModels(key);
      await loadSessions();
    }
    init();
  }, []);

  const fetchSystemApiKey = async () => {
    try {
      const res = await fetch('/api/keys');
      if (res.ok) {
        const keys = await res.json();
        const activeKey = keys.find(k => k.isActive) || keys[0];
        if (activeKey) {
          setSystemApiKey(activeKey.key);
          return activeKey.key;
        }
      }
    } catch (err) {
      console.error('Error fetching system API key:', err);
    }
    return '';
  };

  const fetchModels = async (key) => {
    setIsLoadingModels(true);
    let loaded = [];

    // 1. Try /api/models (authenticated via local session / dashboard)
    try {
      const res = await fetch('/api/models');
      if (res.ok) {
        const data = await res.json();
        if (data.data && data.data.length > 0) {
          loaded = data.data;
        }
      }
    } catch { }

    // 2. Try /v1/models with bearer key if still empty
    if (loaded.length === 0) {
      try {
        const headers = {};
        if (key) headers['Authorization'] = `Bearer ${key}`;
        const res = await fetch('/v1/models', { headers });
        if (res.ok) {
          const data = await res.json();
          if (data.data && data.data.length > 0) {
            loaded = data.data;
          }
        }
      } catch { }
    }

    // 3. Try /api/models/policies if still empty
    if (loaded.length === 0) {
      try {
        const res = await fetch('/api/models/policies');
        if (res.ok) {
          const policies = await res.json();
          if (policies && policies.length > 0) {
            loaded = policies.map(p => ({ id: p.id, owned_by: p.id.split('/')[0] || 'openai' }));
          }
        }
      } catch { }
    }

    // 4. Default fallback list so select dropdown is NEVER empty
    if (loaded.length === 0) {
      loaded = [
        { id: 'sumopod/deepseek-r1', owned_by: 'sumopod' },
        { id: 'sumopod/deepseek-v4-flash', owned_by: 'sumopod' },
        { id: 'kenari/kenari-default', owned_by: 'kenari' },
        { id: 'gpt-4o', owned_by: 'openai' },
        { id: 'gpt-4o-mini', owned_by: 'openai' },
        { id: 'claude-3-5-sonnet-20241022', owned_by: 'anthropic' }
      ];
    }

    setModels(loaded);
    setSelectedModel(prev => {
      if (prev && loaded.some(m => m.id === prev)) return prev;
      return loaded[0].id;
    });
    setIsLoadingModels(false);
  };

  const handleModelChange = (newModel) => {
    setSelectedModel(newModel);
    if (activeSessionId) {
      setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, model: newModel } : s));
      setActiveSession(prev => prev ? { ...prev, model: newModel } : null);
      fetch(`/api/chat/sessions/${activeSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel })
      }).catch(() => {});
    }
  };

  const loadSessions = async () => {
    try {
      const res = await fetch('/api/chat/sessions');
      if (res.ok) {
        const data = await res.json();
        const list = data.sessions || [];
        setSessions(list);
        if (list.length > 0 && !activeSessionId) {
          selectSession(list[0].id);
        } else if (list.length === 0) {
          handleNewChat();
        }
      } else {
        fallbackLocalStorageSessions();
      }
    } catch {
      fallbackLocalStorageSessions();
    }
  };

  const fallbackLocalStorageSessions = () => {
    try {
      const stored = localStorage.getItem('myairouter_chat_sessions');
      if (stored) {
        const parsed = JSON.parse(stored);
        setSessions(parsed);
        if (parsed.length > 0 && !activeSessionId) {
          selectSession(parsed[0].id);
        }
      } else {
        handleNewChat();
      }
    } catch {
      handleNewChat();
    }
  };

  const selectSession = async (id) => {
    setActiveSessionId(id);
    setMessages([]);
    try {
      const res = await fetch(`/api/chat/sessions/${id}`);
      if (res.ok) {
        const data = await res.json();
        setActiveSession(data.session);
        setMessages(data.messages || []);
        if (data.session?.model) {
          setSelectedModel(data.session.model);
        }
        if (data.session?.systemPrompt) {
          setSystemPrompt(data.session.systemPrompt);
        }
      } else {
        loadLocalSessionMessages(id);
      }
    } catch {
      loadLocalSessionMessages(id);
    }
  };

  const loadLocalSessionMessages = (id) => {
    const s = sessions.find(item => item.id === id);
    if (s) {
      setActiveSession(s);
      try {
        const storedMsgs = localStorage.getItem(`myairouter_msgs_${id}`);
        if (storedMsgs) {
          setMessages(JSON.parse(storedMsgs));
        }
      } catch { }
    }
  };

  const handleNewChat = async () => {
    if (isStreaming) {
      abortControllerRef.current?.abort();
      setIsStreaming(false);
    }

    const newId = `session-${Date.now()}`;
    const newSession = {
      id: newId,
      title: 'New Chat',
      model: selectedModel,
      systemPrompt: systemPrompt,
      messageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    setActiveSessionId(newId);
    setActiveSession(newSession);
    setMessages([]);
    setAttachments([]);
    setInput('');

    try {
      const res = await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSession)
      });
      if (res.ok) {
        const created = await res.json();
        setSessions(prev => [created, ...prev.filter(s => s.id !== newId)]);
      } else {
        setSessions(prev => [newSession, ...prev]);
        localStorage.setItem('myairouter_chat_sessions', JSON.stringify([newSession, ...sessions]));
      }
    } catch {
      setSessions(prev => [newSession, ...prev]);
    }

    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleDeleteSession = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this chat session?')) return;

    try {
      await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' });
    } catch { }

    const remaining = sessions.filter(s => s.id !== id);
    setSessions(remaining);
    localStorage.removeItem(`myairouter_msgs_${id}`);
    localStorage.setItem('myairouter_chat_sessions', JSON.stringify(remaining));

    if (activeSessionId === id) {
      if (remaining.length > 0) {
        selectSession(remaining[0].id);
      } else {
        handleNewChat();
      }
    }
  };

  const handleExportSession = (e, id) => {
    e.stopPropagation();
    window.open(`/api/chat/sessions/${id}/export`, '_blank');
  };

  const handleStartRename = (e, s) => {
    e.stopPropagation();
    setEditingTitleId(s.id);
    setEditTitleValue(s.title);
  };

  const handleSaveRename = async (id) => {
    if (!editTitleValue.trim()) {
      setEditingTitleId(null);
      return;
    }
    const newTitle = editTitleValue.trim();
    setSessions(prev => prev.map(s => s.id === id ? { ...s, title: newTitle } : s));
    if (activeSession?.id === id) {
      setActiveSession(prev => ({ ...prev, title: newTitle }));
    }
    setEditingTitleId(null);

    try {
      await fetch(`/api/chat/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      });
    } catch { }
  };

  const appendMessageToStorage = async (sessionId, msg) => {
    try {
      await fetch(`/api/chat/sessions/${sessionId}/append`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg)
      });
    } catch {
      try {
        const key = `myairouter_msgs_${sessionId}`;
        const current = JSON.parse(localStorage.getItem(key) || '[]');
        current.push(msg);
        localStorage.setItem(key, JSON.stringify(current));
      } catch { }
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    addFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addFiles = (files) => {
    const MAX_SIZE = 5 * 1024 * 1024;

    for (const file of files) {
      if (file.size > MAX_SIZE) {
        showToast(`"${file.name}" exceeds the 5MB limit.`);
        continue;
      }

      const isImage = file.type.startsWith('image/');
      const reader = new FileReader();

      if (isImage) {
        reader.onload = (event) => {
          setAttachments(prev => [
            ...prev,
            {
              name: file.name,
              size: file.size,
              type: 'image',
              mimeType: file.type,
              dataUrl: event.target.result
            }
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = (event) => {
          setAttachments(prev => [
            ...prev,
            {
              name: file.name,
              size: file.size,
              type: 'file',
              mimeType: file.type,
              content: event.target.result
            }
          ]);
        };
        reader.readAsText(file);
      }
    }
  };

  const removeAttachment = (index) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const [isDragging, setIsDragging] = useState(false);
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = () => {
    setIsDragging(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handlePaste = (e) => {
    if (e.clipboardData && e.clipboardData.files.length > 0) {
      const files = Array.from(e.clipboardData.files);
      const images = files.filter(f => f.type.startsWith('image/'));
      if (images.length > 0) {
        e.preventDefault();
        addFiles(images);
      }
    }
  };

  const showToast = (msg) => {
    setErrorToast(msg);
    setTimeout(() => setErrorToast(''), 4000);
  };

  const autoGenerateTitle = async (sessionId, promptText) => {
    const words = promptText.trim().replace(/\n+/g, ' ').split(' ');
    let fallbackTitle = words.slice(0, 5).join(' ');
    if (fallbackTitle.length > 35) fallbackTitle = fallbackTitle.slice(0, 32) + '...';
    fallbackTitle = fallbackTitle.charAt(0).toUpperCase() + fallbackTitle.slice(1);

    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: fallbackTitle } : s));
    setActiveSession(prev => prev?.id === sessionId ? { ...prev, title: fallbackTitle } : prev);

    try {
      await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: fallbackTitle })
      });
    } catch { }
  };

  const handleSend = async (customPrompt) => {
    const textToSend = customPrompt || input;
    if ((!textToSend.trim() && attachments.length === 0) || isStreaming) return;

    if (!selectedModel) {
      showToast('Please select a model first');
      return;
    }

    let currSessionId = activeSessionId;
    if (!currSessionId) {
      const newId = `session-${Date.now()}`;
      currSessionId = newId;
      setActiveSessionId(newId);
    }

    const isFirstMessage = messages.length === 0;

    if (chatMode === 'image' || textToSend.trim().startsWith('/image ')) {
      await handleGenerateImage(textToSend.replace(/^\/image\s*/, ''));
      return;
    }

    let finalPrompt = textToSend.trim();
    attachments.filter(a => a.type === 'file').forEach(file => {
      finalPrompt = `[Attached Document: ${file.name} (${(file.size / 1024).toFixed(1)} KB)]\n\`\`\`\n${file.content}\n\`\`\`\n\n${finalPrompt}`;
    });

    const userMsg = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: finalPrompt,
      attachments: [...attachments],
      timestamp: new Date().toISOString()
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setAttachments([]);
    setIsStreaming(true);

    appendMessageToStorage(currSessionId, userMsg);

    if (isFirstMessage) {
      autoGenerateTitle(currSessionId, textToSend);
    }

    const apiMessages = [];
    if (systemPrompt.trim()) {
      apiMessages.push({ role: 'system', content: systemPrompt.trim() });
    }

    newMessages.forEach(m => {
      const imageAttachments = (m.attachments || []).filter(a => a.type === 'image');
      if (imageAttachments.length > 0) {
        const parts = [{ type: 'text', text: m.content || 'Please analyze this image.' }];
        imageAttachments.forEach(img => {
          parts.push({
            type: 'image_url',
            image_url: { url: img.dataUrl }
          });
        });
        apiMessages.push({ role: m.role, content: parts });
      } else {
        apiMessages.push({ role: m.role, content: m.content });
      }
    });

    const assistantIndex = newMessages.length;
    const initialAssistantMsg = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: '',
      reasoning: '',
      isThinking: false,
      isStreaming: true,
      model: selectedModel,
      timestamp: new Date().toISOString()
    };
    setMessages([...newMessages, initialAssistantMsg]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const reqHeaders = { 'Content-Type': 'application/json' };
    if (systemApiKey) {
      reqHeaders['Authorization'] = `Bearer ${systemApiKey}`;
    }

    const thinkingStartTime = Date.now();
    let durationSec = 0;

    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify({
          model: selectedModel,
          messages: apiMessages,
          stream: true
        }),
        signal: controller.signal
      });

      if (!res.ok) {
        const errText = await res.text();
        const errMsg = {
          role: 'assistant',
          content: `Error ${res.status}: ${errText}`,
          isError: true,
          isStreaming: false
        };
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIndex] = errMsg;
          return updated;
        });
        setIsStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedContent = '';
      let accumulatedReasoning = '';
      let currentlyThinking = false;
      let insideThinkTag = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') break;

          try {
            const json = JSON.parse(dataStr);
            const delta = json.choices?.[0]?.delta || {};

            const reasoningChunk = delta.reasoning_content || delta.reasoning || delta.thought || '';
            if (reasoningChunk) {
              currentlyThinking = true;
              accumulatedReasoning += reasoningChunk;
              durationSec = (Date.now() - thinkingStartTime) / 1000;
            }

            const contentChunk = delta.content || '';
            if (contentChunk) {
              if (contentChunk.includes('<think>')) {
                insideThinkTag = true;
                currentlyThinking = true;
                const parts = contentChunk.split('<think>');
                accumulatedContent += parts[0];
                accumulatedReasoning += parts[1] || '';
              } else if (insideThinkTag && contentChunk.includes('</think>')) {
                insideThinkTag = false;
                currentlyThinking = false;
                const parts = contentChunk.split('</think>');
                accumulatedReasoning += parts[0];
                accumulatedContent += parts[1] || '';
                durationSec = (Date.now() - thinkingStartTime) / 1000;
              } else if (insideThinkTag) {
                accumulatedReasoning += contentChunk;
                durationSec = (Date.now() - thinkingStartTime) / 1000;
              } else {
                if (currentlyThinking) {
                  currentlyThinking = false;
                  durationSec = (Date.now() - thinkingStartTime) / 1000;
                }
                accumulatedContent += contentChunk;
              }
            }

            setMessages(prev => {
              const updated = [...prev];
              if (updated[assistantIndex]) {
                updated[assistantIndex] = {
                  ...updated[assistantIndex],
                  content: accumulatedContent,
                  reasoning: accumulatedReasoning,
                  isThinking: currentlyThinking,
                  thinkingDurationSec: durationSec
                };
              }
              return updated;
            });
          } catch { }
        }
      }

      const finalAssistantMsg = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: accumulatedContent,
        reasoning: accumulatedReasoning,
        thinkingDurationSec: durationSec,
        isThinking: false,
        isStreaming: false,
        model: selectedModel,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIndex] = finalAssistantMsg;
        return updated;
      });

      appendMessageToStorage(currSessionId, finalAssistantMsg);
    } catch (err) {
      if (err.name !== 'AbortError') {
        const errMsg = {
          role: 'assistant',
          content: `Error: ${err.message}`,
          isError: true,
          isStreaming: false
        };
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIndex] = errMsg;
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleGenerateImage = async (prompt) => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) return;

    let currSessionId = activeSessionId;
    if (!currSessionId) {
      currSessionId = `session-${Date.now()}`;
      setActiveSessionId(currSessionId);
    }

    const userMsg = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: `🎨 Generate image: "${cleanPrompt}"`,
      timestamp: new Date().toISOString()
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);

    appendMessageToStorage(currSessionId, userMsg);
    if (messages.length === 0) {
      autoGenerateTitle(currSessionId, cleanPrompt);
    }

    const assistantIndex = newMessages.length;
    const initialAssistantMsg = {
      id: `msg-${Date.now() + 1}`,
      role: 'assistant',
      content: 'Generating image...',
      isStreaming: true,
      timestamp: new Date().toISOString()
    };
    setMessages([...newMessages, initialAssistantMsg]);

    try {
      const res = await fetch('/v1/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: cleanPrompt,
          model: selectedModel,
          size: '1024x1024'
        })
      });

      if (!res.ok) {
        throw new Error(`Failed to generate image: ${await res.text()}`);
      }

      const data = await res.json();
      const imageUrl = data.data?.[0]?.url;

      if (!imageUrl) {
        throw new Error('No image URL returned by generator');
      }

      const finalContent = `Here is your generated image for **"${cleanPrompt}"**:\n\n![${cleanPrompt}](${imageUrl})`;
      const finalMsg = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: finalContent,
        imageUrl: imageUrl,
        isStreaming: false,
        model: selectedModel,
        timestamp: new Date().toISOString()
      };

      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIndex] = finalMsg;
        return updated;
      });

      appendMessageToStorage(currSessionId, finalMsg);
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIndex] = {
          role: 'assistant',
          content: `Image generation failed: ${err.message}`,
          isError: true,
          isStreaming: false
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  };

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(s => (s.title || '').toLowerCase().includes(q));
  }, [sessions, searchQuery]);

  const groupedSessions = useMemo(() => groupSessions(filteredSessions), [filteredSessions]);

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: 'flex',
        height: 'calc(100vh - 72px)',
        margin: '-24px',
        position: 'relative',
        background: 'var(--bg-color)',
        overflow: 'hidden'
      }}
    >
      {isDragging && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 9000,
            background: 'rgba(0, 200, 255, 0.1)',
            border: '2px dashed var(--color-primary)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            color: 'var(--color-primary)',
            pointerEvents: 'none'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '48px' }}>upload_file</span>
          <span style={{ fontSize: '18px', fontWeight: 600 }}>Drop files here to upload (max 5MB)</span>
        </div>
      )}

      {lightboxImg && (
        <ImageLightbox
          src={lightboxImg.url}
          alt={lightboxImg.alt}
          onClose={() => setLightboxImg(null)}
        />
      )}

      {errorToast && (
        <div
          style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'var(--color-danger)',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>error</span>
          {errorToast}
        </div>
      )}

      {/* ================= CHAT SESSIONS SIDEBAR ================= */}
      <div
        style={{
          width: isSidebarOpen ? '260px' : '0px',
          minWidth: isSidebarOpen ? '260px' : '0px',
          borderRight: isSidebarOpen ? '1px solid var(--border-color)' : 'none',
          background: 'var(--bg-sidebar)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.22s cubic-bezier(0.4, 0, 0.2, 1), min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
          zIndex: 10,
          position: 'relative'
        }}
      >
        <div style={{ padding: '14px 12px 10px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {/* Top Row: New Chat + Collapse Button */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleNewChat}
              className="btn btn-primary"
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                fontWeight: 600,
                fontSize: '13px',
                padding: '8px 12px'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>add</span>
              New Chat
            </button>
            <button
              onClick={() => setIsSidebarOpen(false)}
              className="btn btn-secondary btn-sm"
              style={{ padding: '6px', borderRadius: '6px' }}
              title="Collapse chat history"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>dock_to_left</span>
            </button>
          </div>

          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <span
              className="material-symbols-outlined"
              style={{
                position: 'absolute',
                left: '8px',
                fontSize: '16px',
                color: 'var(--text-muted)'
              }}
            >
              search
            </span>
            <input
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 10px 6px 28px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-card)',
                color: 'var(--text-main)',
                outline: 'none'
              }}
            />
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '0 8px 12px 8px'
          }}
        >
          {Object.entries(groupedSessions).map(([category, catSessions]) => {
            if (catSessions.length === 0) return null;
            return (
              <div key={category} style={{ marginBottom: '16px' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--text-muted)',
                    padding: '6px 10px 4px 10px'
                  }}
                >
                  {category}
                </div>
                {catSessions.map(s => {
                  const isActive = s.id === activeSessionId;
                  const isEditing = editingTitleId === s.id;

                  return (
                    <div
                      key={s.id}
                      onClick={() => !isEditing && selectSession(s.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        marginBottom: '2px',
                        background: isActive ? 'var(--bg-hover)' : 'transparent',
                        borderLeft: isActive ? '3px solid var(--color-primary)' : '3px solid transparent',
                        color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
                        transition: 'background 0.15s ease'
                      }}
                      className="chat-session-item"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '16px', flexShrink: 0 }}>
                          chat_bubble_outline
                        </span>
                        {isEditing ? (
                          <input
                            type="text"
                            value={editTitleValue}
                            autoFocus
                            onChange={e => setEditTitleValue(e.target.value)}
                            onBlur={() => handleSaveRename(s.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleSaveRename(s.id);
                              if (e.key === 'Escape') setEditingTitleId(null);
                            }}
                            onClick={e => e.stopPropagation()}
                            style={{
                              width: '100%',
                              padding: '2px 4px',
                              fontSize: '12px',
                              borderRadius: '4px',
                              border: '1px solid var(--color-primary)',
                              background: 'var(--bg-card)',
                              color: 'var(--text-main)'
                            }}
                          />
                        ) : (
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontWeight: isActive ? 600 : 400
                            }}
                            title={s.title}
                          >
                            {s.title || 'Untitled Chat'}
                          </span>
                        )}
                      </div>

                      {!isEditing && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            flexShrink: 0,
                            opacity: isActive ? 1 : 0.6
                          }}
                        >
                          <button
                            onClick={e => handleStartRename(e, s)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                            title="Rename"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>edit</span>
                          </button>
                          <button
                            onClick={e => handleExportSession(e, s.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                            title="Export JSONL"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>download</span>
                          </button>
                          <button
                            onClick={e => handleDeleteSession(e, s.id)}
                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px' }}
                            title="Delete"
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div
          style={{
            padding: '10px 12px',
            borderTop: '1px solid var(--border-color)',
            fontSize: '11px',
            color: 'var(--text-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>Sessions: JSONL Stream</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{sessions.length} chats</span>
        </div>
      </div>

      {/* ================= MAIN CHAT PANEL ================= */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          background: 'var(--bg-color)'
        }}
      >
        {/* Top Control Bar */}
        <div
          style={{
            height: '56px',
            borderBottom: '1px solid var(--border-color)',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-card)',
            flexShrink: 0
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Sidebar toggle button */}
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="btn btn-secondary btn-sm"
              style={{
                padding: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: isSidebarOpen ? 'var(--text-muted)' : 'var(--color-primary)'
              }}
              title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                {isSidebarOpen ? 'dock_to_left' : 'menu'}
              </span>
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>
                {activeSession?.title || 'New Chat'}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                {activeSession?.updatedAt ? `• ${formatRelativeTime(activeSession.updatedAt)}` : ''}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Mode Switcher */}
            <div
              style={{
                display: 'flex',
                background: 'var(--bg-surface)',
                borderRadius: '6px',
                padding: '2px',
                border: '1px solid var(--border-color)'
              }}
            >
              <button
                onClick={() => setChatMode('chat')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: chatMode === 'chat' ? 'var(--color-primary)' : 'transparent',
                  color: chatMode === 'chat' ? '#000' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>chat</span>
                Chat
              </button>
              <button
                onClick={() => setChatMode('image')}
                style={{
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer',
                  background: chatMode === 'image' ? 'var(--color-primary)' : 'transparent',
                  color: chatMode === 'image' ? '#000' : 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>palette</span>
                Image Gen
              </button>
            </div>

            {/* Model Selector Dropdown */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '3px 8px'
              }}
            >
              <ProviderIcon provider={selectedModel.includes('/') ? selectedModel.split('/')[0] : 'openai'} size={18} />
              <select
                value={selectedModel}
                onChange={e => handleModelChange(e.target.value)}
                disabled={isLoadingModels}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-main)',
                  fontSize: '12.5px',
                  fontWeight: 500,
                  maxWidth: '240px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {models.map(m => (
                  <option key={m.id} value={m.id} style={{ background: '#1c2128', color: '#fff' }}>
                    {m.id}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={() => setShowSystemPrompt(!showSystemPrompt)}
              className="btn btn-secondary btn-sm"
              style={{
                color: systemPrompt.trim() ? 'var(--color-primary)' : 'var(--text-muted)',
                borderColor: systemPrompt.trim() ? 'var(--color-primary)' : 'var(--border-color)'
              }}
              title="System Prompt"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>tune</span>
            </button>
          </div>
        </div>

        {/* System Prompt Drawer */}
        {showSystemPrompt && (
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-color)',
              background: 'var(--bg-surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>
                System Instruction (Optional)
              </span>
              <button
                onClick={() => setShowSystemPrompt(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
              </button>
            </div>
            <textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              placeholder="e.g. You are a senior software engineer. Provide terse, accurate code."
              rows={2}
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-card)',
                color: 'var(--text-main)',
                fontSize: '12.5px',
                resize: 'vertical',
                outline: 'none'
              }}
            />
          </div>
        )}

        {/* Message Thread */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}
        >
          {messages.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                padding: '40px 20px'
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '16px',
                  background: 'rgba(0, 200, 255, 0.1)',
                  color: 'var(--color-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '16px'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '32px' }}>
                  {chatMode === 'image' ? 'palette' : 'smart_toy'}
                </span>
              </div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px 0', color: 'var(--text-main)' }}>
                {chatMode === 'image' ? 'Image Generation Studio' : 'How can I help you today?'}
              </h2>
              <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', maxWidth: '480px', margin: '0 0 28px 0' }}>
                {chatMode === 'image'
                  ? 'Enter an image prompt below to generate high-resolution images with copy, preview, and download support.'
                  : 'Chat with streaming reasoning / thinking, file attachments (up to 5MB), and automatic title generation.'}
              </p>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '12px',
                  maxWidth: '700px',
                  width: '100%'
                }}
              >
                {[
                  {
                    icon: 'code',
                    title: 'Build a fullstack component',
                    desc: 'Write React hooks with clean types'
                  },
                  {
                    icon: 'psychology',
                    title: 'Reasoning & deep thinking',
                    desc: 'Test DeepSeek R1 / o1 thinking stream'
                  },
                  {
                    icon: 'image',
                    title: 'Generate photorealistic art',
                    desc: 'Create futuristic cityscape illustration'
                  },
                  {
                    icon: 'description',
                    title: 'Analyze document / file',
                    desc: 'Upload code or text file up to 5MB'
                  }
                ].map((item, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      if (item.icon === 'image') {
                        setChatMode('image');
                        setInput('Futuristic cybernetic city at twilight, photorealistic 8k');
                      } else {
                        handleSend(item.title);
                      }
                    }}
                    style={{
                      padding: '14px',
                      borderRadius: '10px',
                      border: '1px solid var(--border-color)',
                      background: 'var(--bg-card)',
                      textAlign: 'left',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                      transition: 'border-color 0.15s ease, background 0.15s ease'
                    }}
                    className="card-hover"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '20px', color: 'var(--color-primary)' }}>
                      {item.icon}
                    </span>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>
                      {item.title}
                    </span>
                    <span style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
                      {item.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, idx) => {
              const isUser = m.role === 'user';

              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isUser ? 'flex-end' : 'flex-start',
                    maxWidth: '860px',
                    width: '100%',
                    margin: '0 auto'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      flexDirection: isUser ? 'row-reverse' : 'row',
                      maxWidth: isUser ? '85%' : '100%',
                      width: isUser ? 'auto' : '100%'
                    }}
                  >
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        background: isUser ? 'var(--color-primary)' : 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        marginTop: '2px'
                      }}
                    >
                      {isUser ? (
                        <span className="material-symbols-outlined" style={{ fontSize: '18px', color: '#000' }}>
                          person
                        </span>
                      ) : (
                        <ProviderIcon
                          provider={m.model?.includes('/') ? m.model.split('/')[0] : 'openai'}
                          size={18}
                        />
                      )}
                    </div>

                    <div
                      style={{
                        flex: 1,
                        background: isUser ? 'var(--bg-hover)' : 'var(--bg-card)',
                        border: '1px solid var(--border-color)',
                        borderRadius: isUser ? '14px 4px 14px 14px' : '4px 14px 14px 14px',
                        padding: '14px 18px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                      }}
                    >
                      {isUser && m.attachments && m.attachments.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                          {m.attachments.map((att, aIdx) => {
                            if (att.type === 'image') {
                              return (
                                <img
                                  key={aIdx}
                                  src={att.dataUrl}
                                  alt={att.name}
                                  onClick={() => setLightboxImg({ url: att.dataUrl, alt: att.name })}
                                  style={{
                                    maxWidth: '180px',
                                    maxHeight: '120px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    objectFit: 'cover',
                                    border: '1px solid var(--border-color)'
                                  }}
                                />
                              );
                            }
                            return (
                              <div
                                key={aIdx}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  padding: '4px 8px',
                                  borderRadius: '6px',
                                  background: 'rgba(255,255,255,0.05)',
                                  fontSize: '11.5px',
                                  border: '1px solid var(--border-color)'
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: '15px' }}>description</span>
                                <span>{att.name}</span>
                                <span style={{ color: 'var(--text-muted)' }}>({(att.size / 1024).toFixed(1)} KB)</span>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {!isUser && (m.reasoning || m.isThinking) && (
                        <ThinkingSection
                          reasoning={m.reasoning}
                          isThinking={m.isThinking}
                          durationSec={m.thinkingDurationSec}
                        />
                      )}

                      <RenderMarkdown
                        content={m.content}
                        onImageClick={(url, alt) => setLightboxImg({ url, alt })}
                      />

                      {!isUser && m.isStreaming && !m.content && !m.reasoning && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '13px' }}>
                          <span className="material-symbols-outlined spin" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>
                            progress_activity
                          </span>
                          Generating response...
                        </div>
                      )}

                      {!isUser && !m.isStreaming && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginTop: '12px',
                            paddingTop: '8px',
                            borderTop: '1px solid var(--border-color)',
                            fontSize: '11px',
                            color: 'var(--text-muted)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>{m.model || selectedModel}</span>
                            {m.timestamp && <span>• {formatRelativeTime(m.timestamp)}</span>}
                          </div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(m.content);
                                alert('Message copied to clipboard!');
                              }}
                              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                              title="Copy response"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>content_copy</span>
                              Copy
                            </button>
                            <button
                              onClick={() => {
                                const lastUserMsg = [...messages].reverse().find(msg => msg.role === 'user');
                                if (lastUserMsg) handleSend(lastUserMsg.content);
                              }}
                              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                              title="Regenerate"
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>refresh</span>
                              Retry
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Input Area */}
        <div
          style={{
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-card)',
            padding: '14px 20px 18px 20px',
            position: 'relative'
          }}
        >
          {attachments.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '10px'
              }}
            >
              {attachments.map((att, idx) => (
                <div
                  key={idx}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-color)',
                    fontSize: '12px',
                    color: 'var(--text-main)'
                  }}
                >
                  {att.type === 'image' ? (
                    <img
                      src={att.dataUrl}
                      alt={att.name}
                      style={{ width: '24px', height: '24px', borderRadius: '4px', objectFit: 'cover' }}
                    />
                  ) : (
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>description</span>
                  )}
                  <span style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {att.name}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    ({(att.size / 1024).toFixed(0)}KB)
                  </span>
                  <button
                    onClick={() => removeAttachment(idx)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      display: 'flex',
                      padding: '2px'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>close</span>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div
            style={{
              position: 'relative',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              background: 'var(--bg-surface)',
              overflow: 'hidden',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onPaste={handlePaste}
              placeholder={
                chatMode === 'image'
                  ? 'Describe an image prompt... (e.g. A hyper-detailed cosmic dragon in neon nebulae)'
                  : 'Message AI Router... (Paste images, attach files up to 5MB, or press Shift+Enter for newline)'
              }
              rows={input.split('\n').length > 1 ? Math.min(input.split('\n').length, 6) : 2}
              style={{
                width: '100%',
                padding: '12px 50px 12px 14px',
                border: 'none',
                background: 'transparent',
                color: 'var(--text-main)',
                fontSize: '14px',
                lineHeight: '1.5',
                resize: 'none',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'inherit'
              }}
            />

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '4px 10px 8px 10px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '6px', borderRadius: '6px' }}
                  title="Attach images or documents (max 5MB)"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>attach_file</span>
                </button>

                <button
                  onClick={() => setChatMode(chatMode === 'image' ? 'chat' : 'image')}
                  className="btn btn-secondary btn-sm"
                  style={{
                    padding: '6px',
                    borderRadius: '6px',
                    color: chatMode === 'image' ? 'var(--color-primary)' : 'var(--text-muted)'
                  }}
                  title="Image Generation Mode"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>palette</span>
                </button>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isStreaming ? (
                  <button
                    onClick={handleStop}
                    className="btn btn-danger btn-sm"
                    style={{
                      borderRadius: '8px',
                      padding: '6px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>stop</span>
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() && attachments.length === 0}
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '8px',
                      border: 'none',
                      background: input.trim() || attachments.length > 0 ? 'var(--color-primary)' : 'var(--border-color)',
                      color: input.trim() || attachments.length > 0 ? '#000' : 'var(--text-muted)',
                      cursor: input.trim() || attachments.length > 0 ? 'pointer' : 'not-allowed',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'background 0.15s ease'
                    }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>
                      {chatMode === 'image' ? 'draw' : 'arrow_upward'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              textAlign: 'center',
              marginTop: '6px',
              fontSize: '11px',
              color: 'var(--text-muted)'
            }}
          >
            Max file size: 5MB • Supports images, documents & reasoning models • Sessions saved as JSONL append stream
          </div>
        </div>
      </div>
    </div>
  );
}
