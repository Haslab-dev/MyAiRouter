import { useState } from 'react';
import { useChatStore } from '../../stores/chatStore';

export default function ConfigModal({ isOpen, onClose }) {
  const [tab, setTab] = useState('mcp');
  const [error, setError] = useState('');

  // MCP form
  const [mcpName, setMcpName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [mcpHeaders, setMcpHeaders] = useState('');

  // Skill form
  const [skillName, setSkillName] = useState('');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillContent, setSkillContent] = useState('');
  const [editingSkill, setEditingSkill] = useState(null);

  const mcpServers = useChatStore(s => s.mcpServers);
  const activeMcpServerIds = useChatStore(s => s.activeMcpServerIds);
  const addMcpServer = useChatStore(s => s.addMcpServer);
  const removeMcpServer = useChatStore(s => s.removeMcpServer);
  const connectMcpServer = useChatStore(s => s.connectMcpServer);
  const disconnectMcpServer = useChatStore(s => s.disconnectMcpServer);
  const toggleMcpServer = useChatStore(s => s.toggleMcpServer);
  const skills = useChatStore(s => s.skills);
  const customSkills = useChatStore(s => s.customSkills);
  const addCustomSkill = useChatStore(s => s.addCustomSkill);
  const removeCustomSkill = useChatStore(s => s.removeCustomSkill);

  if (!isOpen) return null;

  const handleAddMcp = async () => {
    if (!mcpUrl.trim()) { setError('URL is required'); return; }
    setError('');

    let headers = {};
    if (mcpHeaders.trim()) {
      try {
        headers = JSON.parse(mcpHeaders);
      } catch {
        setError('Invalid JSON in headers');
        return;
      }
    }

    const server = addMcpServer({
      url: mcpUrl.trim(),
      name: mcpName.trim() || mcpUrl.trim(),
      headers
    });
    setMcpUrl('');
    setMcpName('');
    setMcpHeaders('');
    try {
      await connectMcpServer(server.id);
    } catch (e) {
      setError(`Failed to connect: ${e.message}`);
    }
  };

  const handleAddSkill = () => {
    if (!skillName.trim()) { setError('Name is required'); return; }
    if (!skillContent.trim()) { setError('Content is required'); return; }
    setError('');
    addCustomSkill(skillName.trim(), skillDesc.trim(), skillContent.trim());
    setSkillName('');
    setSkillDesc('');
    setSkillContent('');
  };

  const handleExportConfig = () => {
    const config = {};
    for (const server of mcpServers) {
      config[server.name] = {
        url: server.url,
        headers: server.headers || {}
      };
    }
    navigator.clipboard.writeText(JSON.stringify(config, null, 2));
  };

  const handleImportConfig = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const config = JSON.parse(text);
      for (const [name, cfg] of Object.entries(config)) {
        if (cfg.url) {
          const server = addMcpServer({ url: cfg.url, name, headers: cfg.headers || {} });
          connectMcpServer(server.id).catch(() => {});
        }
      }
      setError('');
    } catch (e) {
      setError(`Import failed: ${e.message}`);
    }
  };

  const statusColors = {
    connected: '#3fb950',
    connecting: '#d29922',
    disconnected: '#8b949e',
    error: '#f85149'
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '620px', maxHeight: '85vh',
          background: 'var(--bg-card)', borderRadius: '14px',
          border: '1px solid var(--border-color)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border-color)' }}>
          <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-main)' }}>Extensions & Tools</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '4px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>close</span>
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', padding: '0 20px' }}>
          {[
            { id: 'mcp', label: 'MCP Servers', icon: 'extension' },
            { id: 'skills', label: 'Skills', icon: 'conversion_path' }
          ].map(t => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setError(''); setEditingSkill(null); }}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '10px 16px', fontSize: '13px', fontWeight: 600,
                background: 'none', border: 'none', cursor: 'pointer',
                borderBottom: tab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent',
                color: tab === t.id ? 'var(--color-primary)' : 'var(--text-muted)',
                transition: 'all 0.15s ease'
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
          {error && (
            <div style={{ padding: '8px 12px', borderRadius: '6px', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.3)', color: '#f85149', fontSize: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>error</span>
              {error}
            </div>
          )}

          {tab === 'mcp' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Import/Export buttons */}
              <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
                <button onClick={handleImportConfig} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>content_paste</span>
                  Import from clipboard
                </button>
                <button onClick={handleExportConfig} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>content_copy</span>
                  Export config
                </button>
              </div>

              {/* Add MCP Form */}
              <div style={{ borderRadius: '8px', border: '1px solid var(--border-color)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Name (e.g. exa)"
                    value={mcpName}
                    onChange={e => setMcpName(e.target.value)}
                    style={{ width: '140px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '12px', outline: 'none' }}
                  />
                  <input
                    type="text"
                    placeholder="https://mcp.exa.ai/mcp?tools=web_search_exa"
                    value={mcpUrl}
                    onChange={e => setMcpUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddMcp()}
                    style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '12px', fontFamily: 'var(--font-mono)', outline: 'none' }}
                  />
                </div>
                <textarea
                  placeholder='Headers JSON (optional): {"x-api-key": "YOUR_KEY"}'
                  value={mcpHeaders}
                  onChange={e => setMcpHeaders(e.target.value)}
                  rows={2}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '11px', fontFamily: 'var(--font-mono)', outline: 'none', resize: 'none', boxSizing: 'border-box' }}
                />
                <button onClick={handleAddMcp} className="btn btn-primary" style={{ alignSelf: 'flex-end', padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
                  Connect
                </button>
              </div>

              {/* MCP Server List */}
              {mcpServers.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '32px', display: 'block', marginBottom: '8px', opacity: 0.4 }}>extension</span>
                  No MCP servers configured yet.
                </div>
              )}

              {mcpServers.map(server => {
                const isActive = activeMcpServerIds.includes(server.id);
                return (
                  <div key={server.id} style={{ borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: isActive ? 'rgba(63,185,80,0.05)' : 'transparent' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: statusColors[server.status] || statusColors.disconnected, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>{server.name}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{server.url}</div>
                        {Object.keys(server.headers || {}).length > 0 && (
                          <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                            Headers: {Object.keys(server.headers).join(', ')}
                          </div>
                        )}
                        {server.tools.length > 0 && (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {server.tools.length} tools: {server.tools.map(t => t.name).join(', ')}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                        {server.status === 'connected' ? (
                          <>
                            <button onClick={() => toggleMcpServer(server.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: isActive ? 'var(--color-primary)' : 'transparent', color: isActive ? '#fff' : 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                              {isActive ? 'Active' : 'Enable'}
                            </button>
                            <button onClick={() => disconnectMcpServer(server.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}>
                              Disconnect
                            </button>
                          </>
                        ) : server.status === 'connecting' ? (
                          <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span className="material-symbols-outlined spin" style={{ fontSize: '14px' }}>progress_activity</span>
                            Connecting...
                          </span>
                        ) : (
                          <button onClick={() => connectMcpServer(server.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--color-primary)', fontSize: '11px', cursor: 'pointer', fontWeight: 600 }}>
                            Connect
                          </button>
                        )}
                        <button onClick={() => removeMcpServer(server.id)} style={{ padding: '4px', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'skills' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Skill form */}
              {editingSkill ? (
                <div style={{ borderRadius: '8px', border: '1px solid var(--border-color)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>Edit Skill: {editingSkill.name}</span>
                    <button onClick={() => setEditingSkill(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
                    </button>
                  </div>
                  <textarea
                    value={editingSkill.content}
                    onChange={e => setEditingSkill({ ...editingSkill, content: e.target.value })}
                    placeholder="Write skill content in Markdown..."
                    rows={10}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '12px', fontFamily: 'var(--font-mono)', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: '1.6' }}
                  />
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {editingSkill.content.length} characters
                  </div>
                </div>
              ) : (
                <div style={{ borderRadius: '8px', border: '1px solid var(--border-color)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input
                      type="text"
                      placeholder="Skill name"
                      value={skillName}
                      onChange={e => setSkillName(e.target.value)}
                      style={{ width: '160px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '12px', outline: 'none' }}
                    />
                    <input
                      type="text"
                      placeholder="Description (optional)"
                      value={skillDesc}
                      onChange={e => setSkillDesc(e.target.value)}
                      style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '12px', outline: 'none' }}
                    />
                  </div>
                  <textarea
                    placeholder="Skill content in Markdown (required)..."
                    value={skillContent}
                    onChange={e => setSkillContent(e.target.value)}
                    rows={6}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '12px', fontFamily: 'var(--font-mono)', outline: 'none', resize: 'vertical', boxSizing: 'border-box', lineHeight: '1.6' }}
                  />
                  <button onClick={handleAddSkill} className="btn btn-primary" style={{ alignSelf: 'flex-end', padding: '8px 16px', fontSize: '12px', fontWeight: 600, borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>add</span>
                    Add Skill
                  </button>
                </div>
              )}

              {/* Built-in Skills */}
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Built-in</div>
              {skills.map(skill => (
                <div key={skill.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--color-primary)' }}>{skill.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>{skill.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{skill.description}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>/skill:{skill.id}</div>
                  </div>
                  <button
                    onClick={() => setEditingSkill({ ...skill, content: skill.content || '' })}
                    style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}
                  >
                    Edit
                  </button>
                  {skill.isEntry && <span style={{ fontSize: '10px', padding: '2px 6px', borderRadius: '4px', background: 'rgba(0,200,255,0.1)', color: 'var(--color-primary)', fontWeight: 600 }}>ENTRY</span>}
                </div>
              ))}

              {/* Custom Skills */}
              {customSkills.length > 0 && (
                <>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '8px' }}>Custom</div>
                  {customSkills.map(skill => (
                    <div key={skill.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px', color: 'var(--text-muted)' }}>{skill.icon}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>{skill.name}</div>
                        {skill.description && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{skill.description}</div>}
                        <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>/skill:{skill.id}</div>
                        {skill.content && <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px' }}>{skill.content.length} chars</div>}
                      </div>
                      <button
                        onClick={() => setEditingSkill({ ...skill })}
                        style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                      <button onClick={() => removeCustomSkill(skill.id)} style={{ padding: '4px', borderRadius: '4px', border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
