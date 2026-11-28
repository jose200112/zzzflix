import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SITE_KEY, postReport } from '../api/comments'
import { loadTurnstile } from '../api/turnstile'

type ReportButtonProps = {
  titleId: number
  commentId: string
}

// idle: solo el botón.
// verifying: aparece el CAPTCHA y, al resolverlo, el reporte se envía solo.
// sending: esperando a la API.
// done: ya reportado.
type Step = 'idle' | 'verifying' | 'sending' | 'done'

// Reportar no oculta ni borra el comentario: solo avisa para que lo revise una persona
function ReportButton({ titleId, commentId }: ReportButtonProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage ?? 'en'
  const [step, setStep] = useState<Step>('idle')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const widgetRef = useRef<HTMLDivElement>(null)

  // El CAPTCHA solo existe mientras la persona está confirmando el reporte
  useEffect(() => {
    if (step !== 'verifying' || !widgetRef.current) return
    let cancelled = false
    let widgetId: string | undefined

    async function send(token: string) {
      setStep('sending')
      const result = await postReport({
        titleId,
        commentId,
        turnstileToken: token,
      })
      if (result.ok) {
        setStep('done')
        return
      }
      const key = `comments.errors.${result.error}`
      setErrorKey(i18n.exists(key) ? key : 'comments.errors.unknown')
      setStep('idle')
    }

    function captchaUnavailable() {
      setErrorKey('comments.errors.captcha_unavailable')
      setStep('idle')
    }

    loadTurnstile()
      .then(() => {
        if (cancelled || !widgetRef.current || !window.turnstile) return
        widgetId = window.turnstile.render(widgetRef.current, {
          sitekey: SITE_KEY ?? '',
          theme: 'dark',
          language: lang,
          callback: (token) => void send(token),
          'expired-callback': () => {},
          'error-callback': captchaUnavailable,
        })
      })
      .catch(() => {
        if (!cancelled) captchaUnavailable()
      })

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [step, lang, titleId, commentId, i18n])

  if (step === 'done') {
    return (
      <p className="form-message ok" role="status">
        {t('comments.report.thanks')}
      </p>
    )
  }

  return (
    <div className="report">
      {step === 'idle' ? (
        <button
          type="button"
          className="report-btn"
          onClick={() => {
            setErrorKey(null)
            setStep('verifying')
          }}
        >
          {t('comments.report.button')}
        </button>
      ) : (
        <div className="report-confirm">
          <p className="form-note">{t('comments.report.confirm')}</p>
          <div ref={widgetRef} />
          {step === 'sending' && (
            <p className="form-note" role="status">
              {t('comments.report.sending')}
            </p>
          )}
          <button
            type="button"
            className="report-btn"
            disabled={step === 'sending'}
            onClick={() => setStep('idle')}
          >
            {t('comments.report.cancel')}
          </button>
        </div>
      )}
      {errorKey && (
        <p className="form-message error" role="alert">
          {t(errorKey)}
        </p>
      )}
    </div>
  )
}

export default ReportButton
