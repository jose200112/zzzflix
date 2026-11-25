import { useTranslation } from 'react-i18next'
import { LANGUAGES, setLanguage } from '../i18n'

function LanguageSwitcher() {
  const { t, i18n } = useTranslation()

  return (
    <div className="lang-switch" role="group" aria-label={t('nav.language')}>
      {LANGUAGES.map((lang) => (
        <button
          key={lang}
          type="button"
          lang={lang}
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
