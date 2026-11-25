import i18n from 'i18next'
import { initReactI18next, useTranslation } from 'react-i18next'
import es from './locales/es.json'
import en from './locales/en.json'
import de from './locales/de.json'

export const LANGUAGES = ['es', 'en', 'de'] as const
export type Language = (typeof LANGUAGES)[number]

// Para formatear fechas y números según el idioma elegido
export const LOCALES: Record<Language, string> = {
  es: 'es-ES',
  en: 'en-GB',
  de: 'de-DE',
}

const STORAGE_KEY = 'zzzflix:lang'

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value)
}

// 1) lo que eligió el usuario, 2) idioma del navegador, 3) inglés
function detectLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isLanguage(saved)) return saved
  } catch { }
  for (const tag of navigator.languages ?? [navigator.language]) {
    const code = tag.slice(0, 2).toLowerCase()
    if (isLanguage(code)) return code
  }
  return 'en'
}

// Mantiene <html lang> y el título de la pestaña en el idioma activo
function syncDocument() {
  document.documentElement.lang = i18n.language
  document.title = i18n.t('meta.title')
}

i18n.on('initialized', syncDocument)
i18n.on('languageChanged', syncDocument)

void i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
    de: { translation: de },
  },
  lng: detectLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React ya escapa el texto
})

// Solo se guarda lo que el usuario elige a mano, no lo que se detecta solo
export function setLanguage(lang: Language) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch { }
  void i18n.changeLanguage(lang)
}

// Código regional para toLocaleString / toLocaleDateString
export function useLocale(): string {
  const { i18n: instance } = useTranslation()
  return LOCALES[instance.resolvedLanguage as Language] ?? LOCALES.es
}
