const API_URL = import.meta.env.VITE_COMMENTS_API_URL as string | undefined

export const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined

// Sin URL de API o sin clave de Turnstile, la sección se desactiva sola
export const COMMENTS_ENABLED = Boolean(API_URL && SITE_KEY)

export type Comment = {
  nickname: string
  text: string
  createdAt: string
}

type NewComment = {
  titleId: number
  nickname: string
  text: string
  turnstileToken: string
}

export type PostResult = { ok: true } | { ok: false; error: string }

export async function fetchComments(titleId: number): Promise<Comment[]> {
  const res = await fetch(`${API_URL}/comments?titleId=${titleId}`)
  if (!res.ok) throw new Error('fetch_failed')
  const data = (await res.json()) as { comments: Comment[] }
  return data.comments
}

export async function postComment(input: NewComment): Promise<PostResult> {
  try {
    const res = await fetch(`${API_URL}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...input, titleId: String(input.titleId) }),
    })
    if (res.ok) return { ok: true }

    const data = (await res.json().catch(() => ({}))) as { error?: string }
    // Si frena API Gateway (no la Lambda), no viene campo "error"
    if (!data.error && res.status === 429) return { ok: false, error: 'throttled' }
    return { ok: false, error: data.error ?? 'unknown' }
  } catch {
    return { ok: false, error: 'network' }
  }
}
