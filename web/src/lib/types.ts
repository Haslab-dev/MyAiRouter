/** Shared domain types for the myAiRouter admin UI. */

export interface ApiError {
  message: string
  type?: string
}

export interface ProviderConnectionData {
  apiKey?: string
  baseUrl?: string
  modelPrefix?: string
  headers?: Record<string, string>
  orgId?: string
  testStatus?: string
  lastError?: string
  [key: string]: unknown
}

export interface ProviderConnection {
  id: string
  provider: string
  authType: string
  name: string
  email: string
  priority: number
  isActive: boolean
  data: ProviderConnectionData
  createdAt: string
  updatedAt: string
}

export type ComboKind =
  | 'fallback'
  | 'smart'
  | 'load_balance'
  | 'progressive'
  | 'race'
  | 'parallel'
  | 'ensemble'

export type FallbackPolicyName = 'auto' | 'aggressive' | 'conservative'

export interface AttemptPolicy {
  attemptTimeoutMs?: number
  finalTimeoutMs?: number
  maxFallbacks?: number
  fallbackPolicy?: FallbackPolicyName
}

export interface Combo {
  id: string
  name: string
  kind: ComboKind
  models: string[]
  policy?: AttemptPolicy | null
  createdAt: string
  updatedAt: string
}

export interface RoutingConfig {
  primary_provider: string
  fallback_provider?: string | null
  fallback_model?: string | null
}

export interface CompressionConfig {
  enabled: boolean
  strategy: string
  trigger: 'threshold' | 'context_limit'
  threshold_tokens: number
  preserve_recent_messages: number
}

export interface ModelConfig {
  id: string
  name: string
  routing: RoutingConfig
  compression: CompressionConfig
  createdAt?: string
  updatedAt?: string
}

export interface TargetAttempt {
  index: number
  provider: string
  model: string
  connectionId: string
  status: 'success' | 'failed' | 'skipped' | 'winner' | 'cancelled'
  responseCode: number
  durationMs: number
  error?: string
}

export interface TracePipelineStep {
  name: string
  status: string
  details: string
  durationMs?: number
}

export interface FlatTrace {
  id: string
  timestamp: string
  status: 'ok' | 'error'
  provider: string
  model: string
  route: string
  node: string
  routeNodes: string[]
  attempt: number
  totalAttempts: number
  latencyMs: number
  ttfbMs: number
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  compression: number
  cache: string
  cost: number
  isStream: boolean
  retryCount: number
  fallbackCount: number
  targetAttempts: TargetAttempt[]
  pipeline: TracePipelineStep[]
  request?: string
  response?: string
}

export interface ConnectionHealth {
  connectionId: string
  healthy: boolean
  consecutiveFailures: number
  cooldownSecondsLeft: number
  ewmaLatencyMs: number
  ewmaTtfbMs: number
  samples: number
  name?: string
  provider?: string
}

export interface SystemMetrics {
  cpu: { usage: number; count: number }
  memory: { used: number; total: number; used_bytes: number; usedPercent: number }
  storage: { used: number; total: number; used_bytes: number; usedPercent: number }
  health: { status: string }
  uptime?: string
  version?: string
}

export interface AuthStatus {
  requireLogin: boolean
  authenticated: boolean
  version?: string
}

export interface ApiKeyEntry {
  id: string
  key: string
  name: string
  machineId?: string
  isActive: boolean
  createdAt: string
}

export interface ModelEntry {
  id: string
  object: string
  owned_by: string
  created: number
}

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let val = bytes
  let unitIdx = 0
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024
    unitIdx++
  }
  return `${val.toFixed(unitIdx === 0 ? 0 : 1)} ${units[unitIdx]}`
}

export function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return '0'
  return new Intl.NumberFormat().format(n)
}

export function formatCost(cost: number | undefined | null): string {
  if (!cost) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}
