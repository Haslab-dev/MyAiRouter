import { useState } from 'react'

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
  'xiaomi-tokenplan', 'xquik', 'youcom', 'zed',
]

const CUSTOM_MAP: Record<string, string> = {
  'opencode-zen': 'opencode.png',
  'glm-coding': 'glm.png',
  aws: 'aws-polly.png',
  bedrock: 'aws-polly.png',
  kenari: 'kenari.svg',
  sumopod: 'sumopod.png',
  meta: 'meta.svg',
  'meta-ai': 'meta.svg',
  llama: 'meta.svg',
}

export function getProviderIconPath(providerId = '', providerName = ''): string {
  const id = providerId.toLowerCase().trim()
  const name = providerName.toLowerCase().trim()

  if (CUSTOM_MAP[id]) return `/assets/icons/${CUSTOM_MAP[id]}`
  if (KNOWN_ICONS.includes(id)) return `/assets/icons/${id}.png`
  for (const icon of KNOWN_ICONS) {
    if (icon.length >= 3 && (id === icon || id.includes(icon) || name === icon || name.includes(icon))) {
      return `/assets/icons/${icon}.png`
    }
  }
  return '/assets/icons/openai.png'
}

interface ProviderIconProps {
  id?: string
  name?: string
  size?: number
  className?: string
}

export default function ProviderIcon({ id = '', name = '', size = 28, className = '' }: ProviderIconProps) {
  const [hasError, setHasError] = useState(false)
  const iconPath = getProviderIconPath(id, name)

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-2 ${className}`}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      {!hasError ? (
        <img src={iconPath} alt={name || id || 'Provider'} onError={() => setHasError(true)} className="block object-contain" style={{ width: '78%', height: '78%' }} />
      ) : (
        <span className="text-[10px] font-semibold text-subtle">{(name || id || '?').charAt(0).toUpperCase()}</span>
      )}
    </span>
  )
}
