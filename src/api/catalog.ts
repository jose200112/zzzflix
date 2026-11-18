import { curated } from '../data/curated'
import type { Title } from '../data/titles'
import { fetchTitle } from './tmdb'

export async function loadCatalog(): Promise<Title[]> {
  const results = await Promise.allSettled(
    curated.map(async (c) => {
      const t = await fetchTitle(c.tmdbId, c.type)
      return { ...t, type: c.type, sleepScore: c.sleepScore }
    }),
  )

  return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
}