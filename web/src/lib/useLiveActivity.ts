import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

/*
 * Live activity feed — the data behind the Overview "running" animation.
 *
 * Why a poll and not SSE/WebSocket: the gateway serves this from memory
 * (one mutex, no DB), the payload is a few hundred bytes, and one poll
 * interval for the whole app is cheaper and less fragile than a second
 * streaming protocol to maintain. The backend takes `?since=` so a poll
 * returns only sessions that moved since the previous tick.
 *
 * Nothing here is allowed to affect the gateway: a failed poll just leaves
 * the last known state in place and retries on the next tick.
 */

export type LiveSessionStatus = 'running' | 'waiting' | 'ok' | 'error'

export interface LiveSession {
  id: string
  model: string
  provider: string
  combo?: string
  kind?: string
  stream: boolean
  status: LiveSessionStatus
  elapsedMs: number
  step: string
  steps: number
  targets: number
  attempt: number
  inflight: number
  ttfbMs: number
  outTokens: number
  promptTokens: number
  completionTokens: number
  tps: number
  finished: boolean
  responseCode?: number
  error?: string
}

export interface LiveSnapshot {
  generatedAt: string
  rps: number
  tps: number
  active: number
  waiting: number
  /** upstream attempts in flight (all kinds) */
  inflight: number
  /** in-flight attempts that are genuine SSE streams */
  streams: number
  errors: number
  retries: number
  oldestAgeSec: number
  count: number
  sessions: LiveSession[]
}

const EMPTY: LiveSnapshot = {
  generatedAt: '',
  rps: 0,
  tps: 0,
  active: 0,
  waiting: 0,
  inflight: 0,
  streams: 0,
  errors: 0,
  retries: 0,
  oldestAgeSec: 0,
  count: 0,
  sessions: [],
}

/**
 * Polls /api/live and returns the live snapshot.
 *
 * `intervalMs` defaults to 1200ms; pass 0 to disable polling entirely (used
 * when the tab is hidden — a hidden tab must not keep animating).
 */
export function useLiveActivity(intervalMs = 1200, enabled = true) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(EMPTY)
  const sinceRef = useRef<string>('')
  const [stale, setStale] = useState(false)

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return
    let cancelled = false
    let failures = 0

    const tick = async () => {
      try {
        const qs = sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : ''
        const data = await api.get<LiveSnapshot>(`/api/live${qs}`)
        if (cancelled) return
        failures = 0
        setStale(false)
        if (data?.generatedAt) sinceRef.current = data.generatedAt
        setSnapshot(data ?? EMPTY)
      } catch {
        // Transient (gateway restarting, auth bounce): keep the last state
        // and mark it stale rather than blanking the UI.
        failures += 1
        if (!cancelled && failures >= 3) setStale(true)
      }
    }

    tick()
    const id = setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [intervalMs, enabled])

  return { snapshot, stale }
}
