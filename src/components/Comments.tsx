import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { COMMENTS_ENABLED, SITE_KEY, fetchComments, postComment } from '../api/comments'
import type { Comment } from '../api/comments'
import './Comments.css'
import { useTranslation } from 'react-i18next'
import { useLocale } from '../i18n'

const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

type TurnstileApi = {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string
      theme: 'auto' | 'light' | 'dark'
      language: string
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
const URL_RE =
  /(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|net|org|io|xyz|info|biz|ru|cn|tk|ly|app|dev|link|site|online|shop|top|club|store)\b/i

type Message = { kind: 'ok' | 'error'; key: string }

type CommentsProps = {
  titleId: number
}

function Comments({ titleId }: CommentsProps) {
  const { t, i18n } = useTranslation()
  const locale = useLocale()
  // El widget de Turnstile se vuelve a dibujar en el idioma elegido
  const lang = i18n.resolvedLanguage ?? 'en'
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
          language: lang,
          callback: (t) => setToken(t),
          'expired-callback': () => setToken(''),
          'error-callback': () => setToken(''),
        })
      })
      .catch(() => {
        if (!cancelled) {
          setMessage({ kind: 'error', key: 'comments.errors.captcha_unavailable' })
        }
      })
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current)
      }
      widgetId.current = undefined
      setToken('')
    }
  }, [lang])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nick = nickname.trim()
    const body = text.trim()

    if (!NICK_RE.test(nick)) {
      setMessage({ kind: 'error', key: 'comments.errors.invalid_nickname' })
      return
    }
    if (rating < 1 || rating > 5) {
      setMessage({ kind: 'error', key: 'comments.errors.invalid_rating' })
      return
    }
    if (
      body.length < 1 ||
      body.length > 500 ||
      /[<>]/.test(body) ||
      URL_RE.test(body)
    ) {
      setMessage({ kind: 'error', key: 'comments.errors.invalid_text' })
      return
    }
    if (!token) {
      setMessage({
        kind: 'error',
        key: 'comments.completeCaptcha',
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
        key: 'comments.sent',
      })
    } else {
      const key = `comments.errors.${result.error}`
      setMessage({
        kind: 'error',
        key: i18n.exists(key) ? key : 'comments.errors.unknown',
      })
    }
  }

  if (!COMMENTS_ENABLED) {
    return (
      <div className="comments">
        <h2>{t('comments.title')}</h2>
        <p>{t('comments.unavailable')}</p>
      </div>
    )
  }

  return (
    <div className="comments">
      <h2>{t('comments.title')}</h2>

      <form className="comment-form" onSubmit={handleSubmit}>
        <h3>{t('comments.formTitle')}</h3>
        <label>
          {t('comments.nickname')}
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            maxLength={20}
            autoComplete="nickname"
          />
        </label>
        <fieldset className="rating-field">
          <legend>{t('comments.ratingLegend')}</legend>
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
              ? `${'💤'.repeat(rating)} ${t(`comments.ratingHint_${rating}`)}`
              : t('comments.ratingDefault')}
          </span>
        </fieldset>
        <label>
          {t('comments.commentLabel')}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
          />
          <span className="char-count">{text.length}/500</span>
        </label>
        <div ref={widgetRef} />
        <button type="submit" disabled={sending}>
          {sending ? t('comments.sending') : t('comments.send')}
        </button>
        {message && (
          <p className={`form-message ${message.kind}`} role="status">
            {t(message.key)}
          </p>
        )}
        <p className="form-note">
          {t('comments.note')}
        </p>
      </form>

      <h3 className="comments-subtitle">{t('comments.listTitle')}</h3>
      {loadError && <p>{t('comments.loadError')}</p>}
      {!loadError && comments === null && <p>{t('comments.loading')}</p>}
      {comments !== null && comments.length === 0 && (
        <p>{t('comments.empty')}</p>
      )}
      {comments !== null && comments.length > 0 && (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={`${c.createdAt}-${c.nickname}`} className="comment">
              <div className="comment-meta">
                <strong>{c.nickname}</strong>
                {c.rating ? (
                  <span aria-label={t('comments.ratingAria', { rating: c.rating })}>
                    {'💤'.repeat(c.rating)}
                  </span>
                ) : null}
                <span>{new Date(c.createdAt).toLocaleDateString(locale)}</span>
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
