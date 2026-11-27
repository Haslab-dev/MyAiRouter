import { useState } from 'react'
import { Check, CircuitBoard, Copy, MessagesSquare, Network, Zap } from 'lucide-react'
import { Badge, Button, Card, PageContainer, PageHeader } from '@/components/ui'

interface Skill {
  id: string
  name: string
  description: string
  endpoint: string | null
  icon: typeof Network
  isEntry?: boolean
}

const SKILLS: Skill[] = [
  {
    id: 'myairouter',
    name: 'MyAiRouter (Entry)',
    description: 'Setup + index of all capabilities. Covers base URL, auth, model discovery, and lists capability details.',
    endpoint: null,
    icon: Network,
    isEntry: true,
  },
  {
    id: 'myairouter-chat',
    name: 'Chat / Code-gen',
    description: 'Multi-turn conversation and stream completions via OpenAI, Anthropic, or Gemini target formats.',
    endpoint: '/v1/chat/completions',
    icon: MessagesSquare,
  },
  {
    id: 'myairouter-token-saver',
    name: 'Token Saving',
    description: 'Optional compression instructions (Bolt, Headroom, Caveman, Ponytail). Disabled unless you enable it per model.',
    endpoint: '/api/settings',
    icon: Zap,
  },
]

export default function SkillsPage() {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const baseUrl = `${window.location.protocol}//${window.location.host}`
  const getSkillUrl = (id: string) => `${baseUrl}/skills/${id}/SKILL.md`

  const copy = (id: string) => {
    navigator.clipboard.writeText(getSkillUrl(id))
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <PageContainer>
      <PageHeader
        title="Skills"
        description="Machine-readable capability profiles your agent can load directly from the gateway."
      />

      <button
        type="button"
        onClick={() => copy('myairouter')}
        className="mb-6 flex w-full items-center justify-between gap-4 rounded-xl border border-accent bg-accent-subtle px-5 py-4 text-left transition-colors hover:brightness-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <div>
          <div className="mb-1 text-sm text-muted">Paste this instruction URL into your AI agent:</div>
          <code className="font-mono text-xs text-text">{getSkillUrl('myairouter')}</code>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-accent">
          {copiedId === 'myairouter' ? <Check size={15} /> : <Copy size={15} />}
          {copiedId === 'myairouter' ? 'Copied' : 'Copy'}
        </span>
      </button>

      <div className="flex flex-col gap-4">
        {SKILLS.map((skill) => {
          const Icon = skill.icon
          return (
            <Card key={skill.id} className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 items-start gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted">
                  <Icon size={18} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-text">{skill.name}</span>
                    {skill.isEntry && <Badge tone="accent">START HERE</Badge>}
                    {skill.endpoint && <Badge className="font-mono">{skill.endpoint}</Badge>}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">{skill.description}</p>
                  <code className="mt-1.5 block truncate font-mono text-[11px] text-subtle">{getSkillUrl(skill.id)}</code>
                </div>
              </div>
              <div className="shrink-0">
                <Button size="md" onClick={() => copy(skill.id)}>
                  {copiedId === skill.id ? <Check size={14} /> : <Copy size={14} />}
                  {copiedId === skill.id ? 'Copied' : 'Copy link'}
                </Button>
              </div>
            </Card>
          )
        })}
      </div>

      <div className="mt-6 flex items-start gap-2 text-xs text-subtle">
        <CircuitBoard size={13} className="mt-0.5 shrink-0" />
        <span>Skill files are served from the embedded /skills directory and update with the gateway binary.</span>
      </div>
    </PageContainer>
  )
}
