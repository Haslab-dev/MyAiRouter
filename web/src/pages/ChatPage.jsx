import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

function RenderMarkdown({ content }) {
  if (!content) return null;

  // Split code blocks from standard markdown text
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
                  justify: 'space-between',
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

        // Standard text rendering with simple linebreaks
        return (
          <span key={idx} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {part}
          </span>
        );
      })}
    </div>
  );
}

export default function ChatPage() {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [systemApiKey, setSystemApiKey] = useState('');
  const abortControllerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchModels();
    fetchSystemApiKey();
  }, []);

  const fetchSystemApiKey = async () => {
    try {
      const res = await fetch('/api/apikeys');
      if (res.ok) {
        const keys = await res.json();
        const activeKey = keys.find(k => k.isActive);
        if (activeKey) {
          setSystemApiKey(activeKey.key);
        }
      }
    } catch (err) {
      console.error('Error fetching system API key:', err);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const fetchModels = async () => {
    setIsLoadingModels(true);
    try {
      const res = await fetch('/v1/models');
      if (res.ok) {
        const data = await res.json();
        const modelList = data.data || [];
        setModels(modelList);
        if (modelList.length > 0) {
          setSelectedModel(modelList[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSend = async (customPrompt) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || isStreaming) return;

    if (!selectedModel) {
      alert('Please select a model first');
      return;
    }

    const userMessage = { role: 'user', content: textToSend };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    if (!customPrompt) setInput('');

    setIsStreaming(true);

    // Build payload messages including system prompt if set
    const apiMessages = [];
    if (systemPrompt.trim()) {
      apiMessages.push({ role: 'system', content: systemPrompt.trim() });
    }
    apiMessages.push(...newMessages);

    // Placeholder for streaming assistant response
    const assistantIndex = newMessages.length;
    const initialAssistantMsg = { role: 'assistant', content: '', isStreaming: true };
    setMessages([...newMessages, initialAssistantMsg]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const reqHeaders = { 'Content-Type': 'application/json' };
    if (systemApiKey) {
      reqHeaders['Authorization'] = `Bearer ${systemApiKey}`;
    }

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
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIndex] = {
            role: 'assistant',
            content: `Error ${res.status}: ${errText}`,
            isError: true,
            isStreaming: false
          };
          return updated;
        });
        setIsStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
            const contentChunk = json.choices?.[0]?.delta?.content || '';
            if (contentChunk) {
              setMessages(prev => {
                const updated = [...prev];
                const currentContent = updated[assistantIndex]?.content || '';
                updated[assistantIndex] = {
                  ...updated[assistantIndex],
                  content: currentContent + contentChunk
                };
                return updated;
              });
            }
          } catch (e) {
            // Ignore partial chunk parse errors
          }
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        if (updated[assistantIndex]) {
          updated[assistantIndex].isStreaming = false;
        }
        return updated;
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Streaming error:', err);
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIndex] = {
            role: 'assistant',
            content: `Error: ${err.message}`,
            isError: true,
            isStreaming: false
          };
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsStreaming(false);
    }
  };

  const handleClear = () => {
    if (isStreaming) handleStop();
    setMessages([]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)', maxWidth: '1100px', margin: '0 auto' }}>

      {/* Top Header Bar */}
      <div style={{
        display: 'flex',
        justify: 'space-between',
        alignItems: 'center',
        padding: '12px 20px',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-color)',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span className="material-symbols-outlined" style={{ color: 'var(--color-primary)', fontSize: '24px' }}>chat</span>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: '700', margin: 0 }}>Playground Chat</h2>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Test live completions & gateway telemetry</span>
          </div>
        </div>

        {/* Controls: Model Selector & Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--text-muted)' }}>smart_toy</span>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="input-field"
              style={{ padding: '6px 12px', fontSize: '13px', minWidth: '220px', fontWeight: '600' }}
              disabled={isLoadingModels || isStreaming}
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.id} {m.owned_by ? `(${m.owned_by})` : ''}
                </option>
              ))}
            </select>
          </div>

          <button
            className="btn btn-secondary"
            onClick={() => setShowSystemPrompt(!showSystemPrompt)}
            style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>tune</span>
            System
          </button>

          {messages.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={handleClear}
              style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
              Clear
            </button>
          )}

          <button
            className="btn btn-secondary"
            onClick={() => navigate('/traces')}
            style={{ padding: '6px 12px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '16px', color: 'var(--color-primary)' }}>history_toggle_off</span>
            Traces
          </button>
        </div>
      </div>

      {/* System Prompt Collapsible Panel */}
      {showSystemPrompt && (
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          marginBottom: '16px'
        }}>
          <label style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            System Instructions / Persona Directive
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="e.g. You are a helpful AI software engineer. Respond tersely and write clean code..."
            className="input-field"
            style={{ width: '100%', height: '60px', fontSize: '12px', resize: 'vertical' }}
          />
        </div>
      )}

      {/* Chat Messages Container */}
      <div style={{
        flexGrow: 1,
        overflowY: 'auto',
        padding: '16px',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        marginBottom: '16px'
      }}>
        {messages.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-muted)',
            textAlign: 'center',
            gap: '12px'
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.03)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-color)'
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: '28px', color: 'var(--color-primary)' }}>forum</span>
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-main)', marginBottom: '4px' }}>
                Gateway Chat Playground
              </h3>
              <p style={{ fontSize: '13px', maxWidth: '400px', margin: 0 }}>
                Test model completions in real-time. Requests generate live execution traces in the <strong>Traces</strong> tab.
              </p>
            </div>

            {/* Quick Prompt Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '16px', maxWidth: '600px', width: '100%' }}>
              {[
                "Write a Go HTTP handler for SSE streaming",
                "Explain quantum computing in 3 sentences",
                "Refactor a React component to use custom hooks",
                "Analyze memory allocation patterns in Go"
              ].map((promptText, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(promptText)}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    background: 'rgba(255,255,255,0.01)',
                    color: 'var(--text-main)',
                    fontSize: '12px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                  className="card-hover"
                >
                  {promptText}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, index) => {
            const isUser = msg.role === 'user';

            return (
              <div
                key={index}
                style={{
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                  justifyContent: isUser ? 'flex-end' : 'flex-start'
                }}
              >
                {!isUser && (
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: 'var(--color-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    flexShrink: 0
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>smart_toy</span>
                  </div>
                )}

                <div style={{
                  maxWidth: '80%',
                  padding: '12px 16px',
                  borderRadius: isUser ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
                  background: isUser ? 'var(--color-primary)' : 'rgba(255,255,255,0.03)',
                  color: isUser ? '#fff' : 'var(--text-main)',
                  border: isUser ? 'none' : '1px solid var(--border-color)',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                }}>
                  {isUser ? (
                    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '14px' }}>
                      {msg.content}
                    </div>
                  ) : (
                    <>
                      <RenderMarkdown content={msg.content} />
                      {msg.isStreaming && (
                        <span
                          className="material-symbols-outlined"
                          style={{ fontSize: '14px', animation: 'spin 1s linear infinite', marginLeft: '4px', verticalAlign: 'middle' }}
                        >
                          progress_activity
                        </span>
                      )}
                    </>
                  )}
                </div>

                {isUser && (
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-main)',
                    flexShrink: 0
                  }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>person</span>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Form Bar */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={`Message ${selectedModel || 'gateway'}... (Press Enter to send, Shift+Enter for newline)`}
          className="input-field"
          rows={1}
          style={{
            flexGrow: 1,
            padding: '12px 16px',
            fontSize: '14px',
            resize: 'none',
            borderRadius: 'var(--radius-lg)'
          }}
          disabled={isStreaming}
        />

        {isStreaming ? (
          <button
            onClick={handleStop}
            className="btn btn-secondary"
            style={{ padding: '12px 20px', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-danger)' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>stop_circle</span>
            Stop
          </button>
        ) : (
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || !selectedModel}
            className="btn btn-primary"
            style={{
              padding: '12px 20px',
              borderRadius: 'var(--radius-lg)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              opacity: !input.trim() || !selectedModel ? 0.5 : 1
            }}
          >
            <span>Send</span>
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>send</span>
          </button>
        )}
      </div>

    </div>
  );
}
