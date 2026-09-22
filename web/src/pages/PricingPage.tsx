import { useCallback, useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useSnackbar } from '@/stores/snackbar'
import { Badge, Button, Card, Field, Input, Modal, PageContainer, PageHeader, Table, Td } from '@/components/ui'

interface ModelRate {
  input: number
  output: number
  cached: number
}

interface PricingRule extends ModelRate {
  model: string
  provider: string
}

const formatRate = (v: number) => (v === 0 ? '0' : `$${v < 1 ? v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : v.toFixed(2)}`)

export default function PricingPage() {
  const notify = useSnackbar((s) => s.notify)
  const [rules, setRules] = useState<PricingRule[]>([])
  const [usageModels, setUsageModels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState<{ model: string; input: string; output: string; cached: string }>({ model: '', input: '', output: '', cached: '' })

  const fetchRules = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get<{ overrides: Record<string, Record<string, number>> }>('/api/models/pricing')
      const list: PricingRule[] = []
      for (const [key, val] of Object.entries(data.overrides ?? {})) {
        // Skip the mirrored "provider/model" alias row when the bare row exists.
        if (key.includes('/') && (data.overrides ?? {})[key.split('/').pop() ?? '']) continue
        list.push({
          provider: String(val.provider ?? val.Provider ?? ''),
          model: String(val.model ?? val.Model ?? key),
          input: Number(val.input ?? val.Input ?? 0),
          output: Number(val.output ?? val.Output ?? 0),
          cached: Number(val.cached ?? val.Cached ?? 0),
        })
      }
      list.sort((a, b) => a.model.localeCompare(b.model) || a.provider.localeCompare(b.provider))
      setRules(list)
    } catch {
      notify('Failed to load pricing rules', 'error')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => {
    fetchRules()
    api
      .get<{ rates: Record<string, ModelRate> }>('/api/models/pricing?all=1')
      .then((d) => setUsageModels(Object.keys(d.rates ?? {})))
      .catch(() => {})
  }, [fetchRules])

  const openEditor = (rule?: PricingRule) => {
    setDraft(
      rule
        ? { model: rule.model, input: String(rule.input || ''), output: String(rule.output || ''), cached: String(rule.cached || '') }
        : { model: '', input: '', output: '', cached: '' },
    )
    setEditorOpen(true)
  }

  const handleSave = async () => {
    const model = draft.model.trim()
    if (!model) {
      notify('Model name is required', 'error')
      return
    }
    const allBlank = [draft.input, draft.output, draft.cached].every((v) => v.trim() === '' || parseFloat(v) === 0)
    try {
      if (allBlank) {
        await api.del(`/api/models/pricing?model=${encodeURIComponent(model)}`)
        notify(`Pricing rule removed for ${model}`, 'info')
      } else {
        await api.post('/api/models/pricing', {
          model,
          input: parseFloat(draft.input) || 0,
          output: parseFloat(draft.output) || 0,
          cached: parseFloat(draft.cached) || 0,
        })
        notify(`Pricing saved for ${model} — applies to every provider`, 'success')
      }
      setEditorOpen(false)
      fetchRules()
    } catch {
      notify('Failed to save pricing', 'error')
    }
  }

  const handleDelete = async (rule: PricingRule) => {
    if (!confirm(`Delete pricing rule for ${rule.model}${rule.provider ? ` (${rule.provider})` : ''}?`)) return
    try {
      await api.del(`/api/models/pricing?providerAlias=${encodeURIComponent(rule.provider)}&model=${encodeURIComponent(rule.model)}`)
      notify('Pricing rule deleted', 'info')
      fetchRules()
    } catch {
      notify('Failed to delete pricing rule', 'error')
    }
  }

  const knownModels = new Set(usageModels.map((m) => m.split('/').pop() ?? m))

  return (
    <PageContainer>
      <PageHeader
        title="Pricing"
        description="Group pricing by model name — one rule applies to every provider serving that model. Provider-specific overrides set on the provider page take precedence."
        actions={
          <Button size="md" variant="primary" onClick={() => openEditor()}>
            <Plus size={14} /> Add rule
          </Button>
        }
      />

      <Card padded={false} className="overflow-hidden">
        <Table headers={['Model', 'Scope', 'Input $/1M', 'Output $/1M', 'Cache hit $/1M', '']}>
          {rules.length === 0 && !loading ? (
            <tr>
              <Td colSpan={5} className="py-10 text-center text-subtle">
                No pricing rules yet. Add one — e.g. "mimo-v2.6-flash" — and it will match any provider's model with the same name.
              </Td>
            </tr>
          ) : (
            rules.map((rule) => (
              <tr key={`${rule.provider}:${rule.model}`} className="text-[13px]">
                <Td>
                  <code className="font-mono text-xs font-medium">{rule.model}</code>
                </Td>
                <Td>
                  {rule.provider ? (
                    <Badge tone="accent">{rule.provider}</Badge>
                  ) : (
                    <Badge tone="success">All providers</Badge>
                  )}
                </Td>
                <Td className="tnum">{formatRate(rule.input)}</Td>
                <Td className="tnum">{formatRate(rule.output)}</Td>
                <Td className="tnum">{formatRate(rule.cached)}</Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" onClick={() => openEditor(rule)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-subtle hover:text-danger" onClick={() => handleDelete(rule)}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </Td>
              </tr>
            ))
          )}
        </Table>
      </Card>

      <p className="mt-3 text-[11px] text-subtle">
        Rules are matched by model name, so "deepseek-v4-flash" covers <code>deepseek/deepseek-v4-flash</code>, <code>sumopod/deepseek-v4-flash</code>, etc. Provider-specific
        rules override the group rule.
      </p>

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={draft.model ? 'Edit pricing rule' : 'Add pricing rule'}
        subtitle={draft.model || undefined}
        footer={
          <>
            <Button onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSave}>
              Save rule
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Model name" hint="Bare name without provider prefix. Matches every provider serving it.">
            <Input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="e.g. mimo-v2.6-flash" className="font-mono text-xs" list="known-models" />
          </Field>
          <datalist id="known-models">
            {Array.from(knownModels).sort().map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Input $/1M">
              <Input type="number" step="0.0001" min={0} value={draft.input} onChange={(e) => setDraft({ ...draft, input: e.target.value })} placeholder="1.25" />
            </Field>
            <Field label="Output $/1M">
              <Input type="number" step="0.0001" min={0} value={draft.output} onChange={(e) => setDraft({ ...draft, output: e.target.value })} placeholder="5.00" />
            </Field>
            <Field label="Cache hit $/1M">
              <Input type="number" step="0.0001" min={0} value={draft.cached} onChange={(e) => setDraft({ ...draft, cached: e.target.value })} placeholder="0.12" />
            </Field>
          </div>
          <p className="text-[11px] text-subtle">Saving with all prices empty/0 removes the rule. Existing usage rows with a stored cost keep their original price; summaries without cost are recomputed with the current rule.</p>
        </div>
      </Modal>
    </PageContainer>
  )
}
