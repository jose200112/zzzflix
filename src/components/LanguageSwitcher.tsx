import { useTranslation } from 'react-i18next'
import { LANGUAGES, setLanguage } from '../i18n'
import type { Language } from '../i18n'

// Cada idioma con su propio nombre: así un lector de pantalla dice
// "Español", no "e, ese", y al pasar el ratón sale el nombre completo.
const NAMES: Record<Language, string> = {
  es: 'Español',
  en: 'English',
  de: 'Deutsch',
}

function LanguageSwitcher() {
  const { t, i18n } = useTranslation()

  return (
    <div className="lang-switch" role="group" aria-label={t('nav.language')}>
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          lang={lang}
          title={NAMES[lang]}
          aria-label={NAMES[lang]}
          className={i18n.resolvedLanguage === lang ? 'active' : ''}
          aria-pressed={i18n.resolvedLanguage === lang}
          onClick={() => setLanguage(lang)}
        >
          {lang.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

export default LanguageSwitcher
