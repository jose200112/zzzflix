import { curated } from '../data/curated'
import type { Title } from '../data/titles'
import { fetchTitle } from './tmdb'

export async function loadCatalog(): Promise<Title[]> {
  const results = await Promise.allSettled(
    curated.map(async (c) => {
      const t = await fetchTitle(c.tmdbId, c.type)
      // La nota llega aparte (API de comentarios) y se une en App
      return { ...t, type: c.type, rating: null }
    }),
  )

  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
}
