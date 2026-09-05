/** Typed fetch wrapper for the myAiRouter admin + gateway API. */

export class ApiRequestError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

/** Parse the gateway error shape: { error: { message } } or { message }. */
export function parseApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const obj = data as Record<string, unknown>
  const err = obj.error
  if (err && typeof err === 'object') {
    const msg = (err as Record<string, unknown>).message
    if (typeof msg === 'string') return msg
  }
  if (typeof err === 'string') return err
  if (typeof obj.message === 'string') return obj.message
  return fallback
}

type RequestInitWithBody = Omit<RequestInit, 'body'> & { body?: unknown }

async function request<T>(
  url: string,
  init?: RequestInitWithBody,
): Promise<T> {
  const { body, ...rest } = init ?? {}
  const res = await fetch(url, {
    ...rest,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
    body: body !== undefined ? (JSON.stringify(body) as RequestInit['body']) : undefined,
  })

  if (!res.ok) {
    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      /* non-JSON error body */
    }
    throw new ApiRequestError(parseApiError(payload, `Request failed (${res.status})`), res.status)
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    return text as unknown as T
  }
}

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body?: unknown) => request<T>(url, { method: 'POST', body }),
  put: <T>(url: string, body?: unknown) => request<T>(url, { method: 'PUT', body }),
  patch: <T>(url: string, body?: unknown) => request<T>(url, { method: 'PATCH', body }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
}
