import { useState } from 'react';

const KNOWN_ICONS = [
  'agentrouter', 'alicode-intl', 'alicode', 'alims-intl', 'alitp-intl', 'amp', 'anthropic-m',
  'anthropic', 'antigravity', 'api-airforce', 'assemblyai', 'aws-polly', 'azure', 'baidu',
  'bazaarlink', 'black-forest-labs', 'blackbox', 'bluesminds', 'brave-search', 'byteplus',
  'cartesia', 'cerebras', 'chutes', 'claude', 'cline', 'clinepass', 'cloudflare-ai',
  'codebuddy-cn', 'codebuddy-intl', 'codex', 'cohere', 'comfyui', 'commandcode', 'continue',
  'copilot', 'coqui', 'cursor', 'deepgram', 'deepseek-tui', 'deepseek', 'devin-cli',
  'droid', 'edge-tts', 'elevenlabs', 'exa', 'fal-ai', 'featherless', 'firecrawl',
  'fireworks', 'fish-audio', 'gemini-cli', 'gemini', 'github', 'gitlab', 'glm-cn',
  'glm', 'google-pse', 'google-tts', 'grok-cli', 'grok-web', 'groq', 'hermes',
  'huggingface', 'hyperbolic', 'iflow', 'inworld', 'jcode', 'jina-ai', 'jina-reader',
  'kilo-gateway', 'kilocode', 'kimchi', 'kimi-coding', 'kimi', 'kiro', 'linkup',
  'llm7', 'local-device', 'longcat', 'mimo-free', 'minimax-cn', 'minimax', 'mistral',
  'mmf', 'morph', 'nanobanana', 'nebius', 'novita', 'nvidia', 'oai-cc', 'oai-r',
  'ollama-local', 'ollama', 'openai', 'openclaw', 'opencode-go', 'opencode', 'opendesign',
  'openrouter', 'perplexity-agent', 'perplexity-web', 'perplexity', 'playht', 'poolside',
  'qoder', 'qwen', 'recraft', 'reka', 'roo', 'runwayml', 'sambanova', 'sdwebui',
  'searchapi', 'searxng', 'selfhosted-embedding', 'selfhosted-stt', 'selfhosted-tts',
  'serper', 'siliconflow', 'stability-ai', 'tavily', 'tencent', 'together', 'tokenrouter',
  'topaz', 'tortoise', 'trae', 'venice', 'vercel-ai-gateway', 'vercel', 'vertex-partner',
  'vertex', 'volcengine-ark', 'voyage-ai', 'windsurf', 'workbuddy', 'xai', 'xiaomi-mimo',
  'xiaomi-tokenplan', 'xquik', 'youcom', 'zed'
];

export function getProviderIconPath(providerId, providerName = '', providerType = '') {
  const id = (providerId || '').toLowerCase().trim();
  const name = (providerName || '').toLowerCase().trim();
  const type = (providerType || '').toLowerCase().trim();

  // 1. Direct custom mappings for well-known prefixes / variants
  const customMap = {
    'opencode-zen': 'opencode.png',
    'glm-coding': 'glm.png',
    'aws': 'aws-polly.png',
    'bedrock': 'aws-polly.png',
    'kenari': 'kenari.svg',
    'sumopod': 'sumopod.png',
    'meta': 'meta.svg',
    'meta-ai': 'meta.svg',
    'llama': 'meta.svg',
  };

  if (customMap[id]) {
    return `/providers/${customMap[id]}`;
  }

  // 2. Direct exact match in known icons
  if (KNOWN_ICONS.includes(id)) {
    return `/providers/${id}.png`;
  }

  // 3. Match from id or name against known icon keywords
  for (const icon of KNOWN_ICONS) {
    if (icon.length >= 3) {
      if (id === icon || id.includes(icon) || name === icon || name.includes(icon)) {
        return `/providers/${icon}.png`;
      }
    }
  }

  // 4. Fallback based on type
  if (type === 'anthropic-compatible' || id.startsWith('anthropic-compatible') || id.includes('anthropic')) {
    return '/providers/anthropic.png';
  }

  if (type === 'openai-compatible' || id.startsWith('openai-compatible') || id.includes('openai')) {
    return '/providers/openai.png';
  }

  return '/providers/openai.png';
}

export default function ProviderIcon({
  id = '',
  name = '',
  type = '',
  size = 28,
  className = '',
  style = {}
}) {
  const [hasError, setHasError] = useState(false);
  const iconPath = getProviderIconPath(id, name, type);

  return (
    <div
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        borderRadius: size >= 40 ? '10px' : '6px',
        background: 'rgba(255, 255, 255, 0.05)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0,
        ...style,
      }}
    >
      {!hasError && iconPath ? (
        <img
          src={iconPath}
          alt={name || id || 'Provider'}
          onError={() => setHasError(true)}
          style={{
            width: '78%',
            height: '78%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
      ) : (
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: `${Math.round(size * 0.55)}px`,
            color: 'var(--color-primary)',
          }}
        >
          {type === 'anthropic-compatible' ? 'bubble_chart' : 'smart_toy'}
        </span>
      )}
    </div>
  );
}
