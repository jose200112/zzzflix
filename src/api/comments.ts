import type { Rating } from '../data/rating'

const API_URL = import.meta.env.VITE_COMMENTS_API_URL as string | undefined

export const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined

// Sin URL de API o sin clave de Turnstile, la sección se desactiva sola
export const COMMENTS_ENABLED = Boolean(API_URL && SITE_KEY)

export type Comment = {
  id: string // clave del comentario: el botón de reportar la devuelve a la API
  nickname: string
  text: string
  rating?: number // los comentarios antiguos no tienen nota
  createdAt: string
}

type NewComment = {
  titleId: number
  nickname: string
  text: string
  rating: number
  turnstileToken: string
}

// status: 'published' | 'pending' al comentar; vacío al reportar
export type PostResult =
  | { ok: true; status: string }
  | { ok: false; error: string }

export async function fetchComments(titleId: number): Promise<Comment[]> {
  const res = await fetch(`${API_URL}/comments?titleId=${titleId}`)
  if (!res.ok) throw new Error('fetch_failed')
  const data = (await res.json()) as { comments: Comment[] }
  return data.comments
}

// Medias de todas las películas valoradas, indexadas por id de TMDB
export async function fetchRatings(): Promise<Record<number, Rating>> {
  if (!API_URL) return {}
  const res = await fetch(`${API_URL}/ratings`)
  if (!res.ok) throw new Error('fetch_failed')
  const data = (await res.json()) as {
    ratings: { titleId: string; count: number; average: number }[]
  }
  return Object.fromEntries(
    data.ratings.map((r) => [
      Number(r.titleId),
      { count: r.count, average: r.average },
    ]),
  )
}

// POST de JSON a la API. Convierte la respuesta en un resultado sencillo.
async function postJson(path: string, payload: unknown): Promise<PostResult> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = (await res.json().catch(() => ({}))) as {
      status?: string
      error?: string
    }
    if (res.ok) return { ok: true, status: data.status ?? '' }

    // Si frena API Gateway (no la Lambda), no viene campo "error"
    if (!data.error && res.status === 429) return { ok: false, error: 'throttled' }
    return { ok: false, error: data.error ?? 'unknown' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export function postComment(input: NewComment): Promise<PostResult> {
  return postJson('/comments', { ...input, titleId: String(input.titleId) })
}

type NewReport = {
  titleId: number
  commentId: string
  turnstileToken: string
}

// Reportar un comentario: no lo oculta ni lo borra, solo avisa para que lo revise una persona
export function postReport(input: NewReport): Promise<PostResult> {
  return postJson('/reports', { ...input, titleId: String(input.titleId) })
}
