import type { Title } from '../data/titles'
import catalog from '../data/catalog.json'

// El catálogo se genera en local con "npm run catalog" (ver scripts/catalog.mjs)
// y se guarda en el repositorio: la web ya no llama a TMDB.
type CatalogEntry = Omit<Title, 'rating'>

export async function loadCatalog(): Promise<Title[]> {
  return (catalog as CatalogEntry[]).map((t) => ({ ...t, rating: null }))
}
