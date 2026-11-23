import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { COMMENTS_ENABLED, SITE_KEY, fetchComments, postComment } from '../api/comments'
import type { Comment } from '../api/comments'
import './Comments.css'

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string
      theme: 'auto' | 'light' | 'dark'
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    },
  ) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

// Carga el script de Turnstile una sola vez
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    )
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', () => resolve())
    script.addEventListener('error', () => reject(new Error('turnstile_script')))
    if (!existing) {
      script.src = SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
  })
}

// Mismas reglas que la Lambda; aquí solo sirven para avisar antes.
// La validación que protege de verdad es la del servidor.
const NICK_RE = /^[\p{L}\p{N} _-]{2,20}$/u
const URL_RE = /(https?:\/\/|www\.)/i

const RATING_HINTS = [
  '',
  'Me mantuvo despierto',
  'Algún bostezo',
  'Cabeceé un poco',
  'Dormí a ratos',
  'Dormí como un bebé',
]

const ERRORS: Record<string, string> = {
  invalid_nickname:
    'El apodo debe tener entre 2 y 20 caracteres: letras, números, espacios, _ o -.',
  invalid_rating: 'Elige cuánto te ha dormido, de 1 a 5.',
  invalid_text:
    'El comentario debe tener entre 1 y 500 caracteres, sin enlaces ni los símbolos < >.',
  ip_limit: 'Has alcanzado el límite de comentarios de hoy. Vuelve mañana.',
  daily_limit:
    'Hoy ya se han enviado demasiados comentarios en total. Inténtalo mañana.',
  captcha_failed:
    'No hemos podido verificar que eres una persona. Inténtalo de nuevo.',
  captcha_unavailable:
    'La verificación no está disponible ahora mismo. Inténtalo en un rato.',
  comments_disabled: 'Los comentarios están cerrados temporalmente.',
  throttled: 'Demasiadas peticiones seguidas. Espera unos segundos.',
  network: 'No se ha podido conectar. Revisa tu conexión.',
}

type Message = { kind: 'ok' | 'error'; text: string }

type CommentsProps = {
  titleId: number
}

function Comments({ titleId }: CommentsProps) {
  const [comments, setComments] = useState<Comment[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [nickname, setNickname] = useState('')
  const [text, setText] = useState('')
  const [rating, setRating] = useState(0)
  const [token, setToken] = useState('')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<Message | null>(null)

  const widgetRef = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | undefined>(undefined)

  // Lista de comentarios aprobados
  useEffect(() => {
    if (!COMMENTS_ENABLED) return
    let cancelled = false
    fetchComments(titleId)
      .then((list) => {
        if (!cancelled) setComments(list)
      })
      .catch(() => {
        if (!cancelled) setLoadError(true)
      })
    return () => {
      cancelled = true
    }
  }, [titleId])

  // Widget de Turnstile
  useEffect(() => {
    if (!COMMENTS_ENABLED || !widgetRef.current) return
    let cancelled = false
    loadTurnstile()
      .then(() => {
        if (cancelled || !widgetRef.current || !window.turnstile) return
        widgetId.current = window.turnstile.render(widgetRef.current, {
          sitekey: SITE_KEY ?? '',
          theme: 'dark',
          callback: (t) => setToken(t),
          'expired-callback': () => setToken(''),
          'error-callback': () => setToken(''),
        })
      })
      .catch(() => {
        if (!cancelled) {
          setMessage({ kind: 'error', text: ERRORS.captcha_unavailable })
        }
      })
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current)
      }
      widgetId.current = undefined
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nick = nickname.trim()
    const body = text.trim()

    if (!NICK_RE.test(nick)) {
      setMessage({ kind: 'error', text: ERRORS.invalid_nickname })
      return
    }
    if (rating < 1 || rating > 5) {
      setMessage({ kind: 'error', text: ERRORS.invalid_rating })
      return
    }
    if (
      body.length < 1 ||
      body.length > 500 ||
      /[<>]/.test(body) ||
      URL_RE.test(body)
    ) {
      setMessage({ kind: 'error', text: ERRORS.invalid_text })
      return
    }
    if (!token) {
      setMessage({
        kind: 'error',
        text: 'Completa la verificación antes de enviar.',
      })
      return
    }

    setSending(true)
    setMessage(null)
    const result = await postComment({
      titleId,
      nickname: nick,
      text: body,
      rating,
      turnstileToken: token,
    })
    setSending(false)

    // Cada token vale una sola vez: se pide uno nuevo tras cada envío
    setToken('')
    if (widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current)
    }

    if (result.ok) {
      setText('')
      setRating(0)
      setMessage({
        kind: 'ok',
        text: '¡Gracias! Tu comentario y tu nota se publicarán cuando sean aprobados.',
      })
    } else {
      setMessage({
        kind: 'error',
        text:
          ERRORS[result.error] ??
          'No se ha podido enviar el comentario. Inténtalo más tarde.',
      })
    }
  }

  if (!COMMENTS_ENABLED) {
    return (
      <div className="comments">
        <h2>Comentarios</h2>
        <p>Los comentarios no están disponibles ahora mismo.</p>
      </div>
    )
  }

  return (
    <div className="comments">
      <h2>Comentarios</h2>

      <form className="comment-form" onSubmit={handleSubmit}>
        <h3>Deja tu comentario</h3>
        <label>
          Apodo
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            autoComplete="nickname"
          />
        </label>
        <fieldset className="rating-field">
          <legend>¿Cuánto te ha dormido?</legend>
          <div className="rating-options">
            {[1, 2, 3, 4, 5].map((n) => (
              <label
                key={n}
                className={`rating-option ${rating === n ? 'selected' : ''}`}
              >
                <input
                  type="radio"
                  name="rating"
                  value={n}
                  checked={rating === n}
                  onChange={() => setRating(n)}
                />
                <span>{n}</span>
              </label>
            ))}
          </div>
          <span className="rating-hint">
            {rating > 0
              ? `${'💤'.repeat(rating)} ${RATING_HINTS[rating]}`
              : '1 = nada, 5 = a dormir'}
          </span>
        </fieldset>
        <label>
          Comentario
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
          />
          <span className="char-count">{text.length}/500</span>
        </label>
        <div ref={widgetRef} />
        <button type="submit" disabled={sending}>
          {sending ? 'Enviando…' : 'Enviar comentario'}
        </button>
        {message && (
          <p className={`form-message ${message.kind}`} role="status">
            {message.text}
          </p>
        )}
        <p className="form-note">
          Los comentarios y las notas se revisan antes de publicarse.
        </p>
      </form>

      <h3 className="comments-subtitle">Lo que dicen</h3>
      {loadError && <p>No se han podido cargar los comentarios.</p>}
      {!loadError && comments === null && <p>Cargando comentarios…</p>}
      {comments !== null && comments.length === 0 && (
        <p>Aún no hay comentarios. ¡Sé el primero!</p>
      )}
      {comments !== null && comments.length > 0 && (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={`${c.createdAt}-${c.nickname}`} className="comment">
              <div className="comment-meta">
                <strong>{c.nickname}</strong>
                {c.rating ? (
                  <span aria-label={`Nota: ${c.rating} de 5`}>
                    {'💤'.repeat(c.rating)}
                  </span>
                ) : null}
                <span>{new Date(c.createdAt).toLocaleDateString('es-ES')}</span>
              </div>
              {/* React escapa el texto: nunca se interpreta como HTML */}
              <p>{c.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default Comments
