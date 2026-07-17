import { useState } from 'react';

const SKILLS = [
  {
    id: "myairouter",
    name: "myAiRouter (Entry)",
    description: "Setup + index of all capabilities. Covers base URL, auth, model discovery, and lists capability details.",
    endpoint: null,
    icon: "hub",
    isEntry: true,
  },
  {
    id: "myairouter-chat",
    name: "Chat / Code-gen",
    description: "Multi-turn conversation and stream completions via OpenAI, Anthropic, or Gemini target formats.",
    endpoint: "/v1/chat/completions",
    icon: "chat",
  },
  {
    id: "myairouter-token-saver",
    name: "Token Saving",
    description: "Instructions detailing the Bolt (RTK), Headroom, Caveman, and Ponytail compression specifications.",
    endpoint: "/api/settings",
    icon: "bolt",
  },
];

export default function SkillsPage() {
  const [copiedId, setCopiedId] = useState(null);

  const getSkillUrl = (id) => {
    // Generate local skill link
    return `http://localhost:20128/skills/${id}/SKILL.md`;
  };

  const copyLink = (id) => {
    navigator.clipboard.writeText(getSkillUrl(id));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Agent Skills</h1>
          <p className="page-description">Inject capabilities directly into autonomous frameworks (Cline, Roo, Claude Code).</p>
        </div>
      </div>

      <div className="card" style={{ borderLeft: '3px solid var(--color-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <span className="material-symbols-outlined text-primary" style={{ fontSize: '20px' }}>info</span>
          <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>Paste this instruction URL directly to your AI agent:</div>
        </div>
        <div 
          onClick={() => copyLink('myairouter')}
          style={{ 
            fontFamily: 'var(--font-mono)', 
            fontSize: '12px', 
            background: 'rgba(0,0,0,0.3)', 
            padding: '10px 14px', 
            borderRadius: '6px', 
            border: '1px solid var(--border-color)',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span>{getSkillUrl('myairouter')}</span>
          <span style={{ color: 'var(--color-primary)', fontSize: '11px', fontWeight: 600 }}>
            {copiedId === 'myairouter' ? 'Copied!' : 'Click to copy'}
          </span>
        </div>
      </div>

      <div className="skills-list" style={{ marginTop: '24px' }}>
        {SKILLS.map((skill) => (
          <div key={skill.id} className="skill-row">
            <div className="skill-info">
              <div className="skill-icon">
                <span className="material-symbols-outlined">{skill.icon}</span>
              </div>
              <div className="skill-details">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="skill-name">{skill.name}</span>
                  {skill.isEntry && <span className="badge badge-primary">START HERE</span>}
                  {skill.endpoint && (
                    <span className="badge" style={{ backgroundColor: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '10px' }}>
                      {skill.endpoint}
                    </span>
                  )}
                </div>
                <div className="skill-desc">{skill.description}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-subtle)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
                  {getSkillUrl(skill.id)}
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => copyLink(skill.id)}
              className="btn btn-secondary" 
              style={{ fontSize: '12px', padding: '8px 16px', shrink: 0 }}
            >
              {copiedId === skill.id ? 'Copied' : 'Copy link'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
