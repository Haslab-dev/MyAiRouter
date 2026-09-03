import { useState, useEffect, useRef } from 'react';
import ProviderIcon from '../components/ProviderIcon';
import MarkdownRenderer from '../components/chat/MarkdownRenderer';
import BenchmarkResult from '../components/chat/BenchmarkResult';

export default function BenchmarkPage() {
  const [models, setModels] = useState([]);
  const [selectedModels, setSelectedModels] = useState([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [results, setResults] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [lightboxImg, setLightboxImg] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    async function fetchModels() {
      setIsLoadingModels(true);
      let loaded = [];
      try {
        const res = await fetch('/api/models');
        if (res.ok) {
          const data = await res.json();
          if (data.data && data.data.length > 0) loaded = data.data;
        }
      } catch {}
      if (loaded.length === 0) {
        try {
          const res = await fetch('/v1/models');
          if (res.ok) {
            const data = await res.json();
            if (data.data && data.data.length > 0) loaded = data.data;
          }
        } catch {}
      }
      // Deduplicate
      const seen = new Set();
      const deduped = loaded.filter(m => {
        if (seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
      setModels(deduped);
      setIsLoadingModels(false);
    }
    fetchModels();
  }, []);

  const toggleModel = (modelId) => {
    setSelectedModels(prev => {
      if (prev.includes(modelId)) return prev.filter(m => m !== modelId);
      if (prev.length >= 3) return prev;
      return [...prev, modelId];
    });
  };

  const handleRun = async () => {
    if (!prompt.trim() || selectedModels.length === 0 || isRunning) return;

    const userPrompt = prompt.trim();
    setIsRunning(true);
    setResults([]);

    const apiMessages = [];
    if (systemPrompt.trim()) {
      apiMessages.push({ role: 'system', content: systemPrompt.trim() });
    }
    apiMessages.push({ role: 'user', content: userPrompt });

    const initial = selectedModels.map(model => ({
      model,
      content: '',
      reasoning: '',
      isThinking: false,
      streaming: true,
      error: null,
      latency: 0,
      tokensPerSec: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0
    }));
    setResults(initial);

    const promises = initial.map((result, idx) => {
      return new Promise(async (resolve) => {
        const startTime = Date.now();
        try {
          const headers = { 'Content-Type': 'application/json' };
          const res = await fetch('/v1/chat/completions', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              model: result.model,
              messages: apiMessages,
              max_tokens: 4096,
              stream: true
            })
          });

          if (!res.ok) {
            const errText = await res.text();
            setResults(prev => prev.map((r, i) => i === idx ? { ...r, error: `${res.status}: ${errText}`, streaming: false } : r));
            resolve();
            return;
          }

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let content = '';
          let reasoning = '';
          let outputTokens = 0;
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

                // Reasoning/thinking
                const reasoningChunk = delta.reasoning_content || delta.reasoning || delta.thought || '';
                if (reasoningChunk) {
                  currentlyThinking = true;
                  reasoning += reasoningChunk;
                  setResults(prev => prev.map((r, i) => i === idx ? { ...r, reasoning, isThinking: true } : r));
                }

                const contentChunk = delta.content || '';
                if (contentChunk) {
                  // Handle <think> tags
                  if (contentChunk.includes('<think>')) {
                    insideThinkTag = true;
                    currentlyThinking = true;
                    const parts = contentChunk.split('<think>');
                    content += parts[0];
                    reasoning += parts[1] || '';
                  } else if (insideThinkTag && contentChunk.includes('</think>')) {
                    insideThinkTag = false;
                    currentlyThinking = false;
                    const parts = contentChunk.split('</think>');
                    reasoning += parts[0];
                    content += parts[1] || '';
                  } else if (insideThinkTag) {
                    reasoning += contentChunk;
                  } else {
                    if (currentlyThinking) currentlyThinking = false;
                    content += contentChunk;
                  }
                  outputTokens++;
                  setResults(prev => prev.map((r, i) => i === idx ? { ...r, content, reasoning, isThinking: currentlyThinking } : r));
                }

                if (json.usage) {
                  const latency = Date.now() - startTime;
                  setResults(prev => prev.map((r, i) => i === idx ? {
                    ...r,
                    streaming: false,
                    isThinking: false,
                    latency,
                    tokensPerSec: outputTokens / (latency / 1000),
                    inputTokens: json.usage.prompt_tokens || 0,
                    outputTokens: json.usage.completion_tokens || outputTokens,
                    cacheTokens: json.usage.prompt_tokens_details?.cached_tokens || 0
                  } : r));
                }
              } catch {}
            }
          }

          const latency = Date.now() - startTime;
          setResults(prev => prev.map((r, i) => i === idx ? {
            ...r,
            content,
            streaming: false,
            latency,
            tokensPerSec: r.tokensPerSec || outputTokens / (latency / 1000),
            outputTokens: r.outputTokens || outputTokens
          } : r));
        } catch (e) {
          setResults(prev => prev.map((r, i) => i === idx ? { ...r, error: e.message, streaming: false } : r));
        }
        resolve();
      });
    });

    await Promise.all(promises);
    setIsRunning(false);
  };

  const handleStop = () => {
    setIsRunning(false);
  };

  const cols = selectedModels.length || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 72px)', margin: '-24px', overflow: 'hidden' }}>
      {/* Lightbox */}
      {lightboxImg && (
        <div onClick={() => setLightboxImg(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={lightboxImg.url} alt={lightboxImg.alt} onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: '8px' }} />
          <button onClick={() => setLightboxImg(null)} style={{ position: 'absolute', top: 20, right: 24, background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: '8px', padding: '8px 12px', cursor: 'pointer' }}>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      )}

      {/* Config Panel */}
      <div style={{ borderBottom: '1px solid var(--border-color)', padding: '16px 24px', background: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '22px', color: 'var(--color-primary)' }}>compare</span>
            <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)' }}>Model Benchmark</span>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>One-shot comparison, no session history</span>
          </div>
        </div>

        {/* Model Selector */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {models.map(m => {
            const selected = selectedModels.includes(m.id);
            const atLimit = selectedModels.length >= 3 && !selected;
            return (
              <button
                key={m.id}
                onClick={() => !atLimit && toggleModel(m.id)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  border: `1.5px solid ${selected ? 'var(--color-primary)' : 'var(--border-color)'}`,
                  background: selected ? 'var(--color-primary)' : 'var(--bg-surface)',
                  color: selected ? '#fff' : atLimit ? 'var(--text-subtle)' : 'var(--text-main)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: atLimit ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-mono)',
                  opacity: atLimit ? 0.4 : 1,
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                title={m.id}
              >
                <ProviderIcon provider={m.id.includes('/') ? m.id.split('/')[0] : 'openai'} size={14} />
                {selected && '✓ '}{m.id}
              </button>
            );
          })}
          <span style={{ fontSize: '12px', color: selectedModels.length >= 3 ? 'var(--color-warning)' : 'var(--text-muted)', fontWeight: 600, alignSelf: 'center', marginLeft: '4px' }}>
            {selectedModels.length}/3
          </span>
        </div>

        {/* System Prompt */}
        <button
          onClick={() => setShowSystemPrompt(!showSystemPrompt)}
          className="btn btn-secondary btn-sm"
          style={{ fontSize: '11px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>tune</span>
          System Prompt {showSystemPrompt ? '(visible)' : '(hidden)'}
        </button>
        {showSystemPrompt && (
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            placeholder="Optional system instruction..."
            rows={2}
            style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '12px', fontFamily: 'var(--font-mono)', outline: 'none', resize: 'vertical', boxSizing: 'border-box', marginBottom: '8px' }}
          />
        )}

        {/* Input */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleRun(); } }}
            placeholder="Type your test prompt..."
            rows={2}
            style={{ flex: 1, padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-surface)', color: 'var(--text-main)', fontSize: '14px', outline: 'none', resize: 'none', boxSizing: 'border-box' }}
          />
          {isRunning ? (
            <button onClick={handleStop} className="btn btn-danger" style={{ padding: '10px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, fontSize: '13px' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>stop</span>
              Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              disabled={!prompt.trim() || selectedModels.length === 0}
              className="btn btn-primary"
              style={{
                padding: '10px 20px',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                opacity: !prompt.trim() || selectedModels.length === 0 ? 0.5 : 1
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>play_arrow</span>
              Run
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {results.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', textAlign: 'center' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '48px', opacity: 0.3, marginBottom: '12px' }}>compare</span>
            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Select models and run a benchmark</div>
            <div style={{ fontSize: '12px' }}>Pick up to 3 models, type a prompt, and hit Run to compare side by side</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '16px', alignItems: 'start' }}>
            {results.map((result, idx) => (
              <BenchmarkResult key={idx} result={result} onImageClick={(url, alt) => setLightboxImg({ url, alt })} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
