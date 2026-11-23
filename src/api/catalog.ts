import type { Title } from '../data/titles'

// El catálogo se genera en local con "npm run catalog" (ver scripts/catalog.mjs)
// y se guarda en el repositorio: la web ya no llama a TMDB.
// Se importa de forma dinámica para que viaje en su propio fichero y no
// engorde el código de la página principal.
type CatalogEntry = Omit<Title, 'rating'>

export async function loadCatalog(): Promise<Title[]> {
  const { default: catalog } = await import('../data/catalog.json')
  return (catalog as CatalogEntry[]).map((t) => ({ ...t, rating: null }))
}
