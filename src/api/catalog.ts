import type { Title } from '../data/titles'
import type { Language } from '../i18n'

// El catálogo se genera en local con "npm run catalog" (ver scripts/catalog.mjs)
// y se guarda en el repositorio: la web no llama a TMDB.
//
// Los datos que no cambian con el idioma (id, año, tipo, duración) están en
// catalog/base.json, y los textos (título, sinopsis, póster) en un archivo por
// idioma. Cada archivo se importa de forma dinámica: viaja en su propio fichero
// y el navegador solo descarga el del idioma activo.
type BaseEntry = Pick<Title, 'id' | 'year' | 'type' | 'runtime'>
type TextEntry = Pick<Title, 'title' | 'overview' | 'posterUrl'>

const loadTexts: Record<Language, () => Promise<{ default: unknown }>> = {
  es: () => import('../data/catalog/es.json'),
  en: () => import('../data/catalog/en.json'),
  de: () => import('../data/catalog/de.json'),
}

export async function loadCatalog(lang: Language): Promise<Title[]> {
  const [{ default: base }, { default: texts }] = await Promise.all([
    import('../data/catalog/base.json'),
    loadTexts[lang](),
  ])
  const byId = texts as Record<string, TextEntry>
  return (base as BaseEntry[]).map((b) => ({
    ...b,
    title: byId[b.id]?.title ?? String(b.id),
    overview: byId[b.id]?.overview ?? '',
    posterUrl: byId[b.id]?.posterUrl ?? null,
    rating: null,
  }))
}
