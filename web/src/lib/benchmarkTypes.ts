export interface TokenUsageShape {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
}

export function formatNumber(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—'
  return new Intl.NumberFormat().format(n)
}
