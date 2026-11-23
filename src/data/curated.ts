export type CuratedTitle = {
  tmdbId: number
  type: 'movie' | 'series'
}

export const curated: CuratedTitle[] = [
  { tmdbId: 1398, type: 'movie' },   // Stalker
  { tmdbId: 31414, type: 'movie' },  // Sátántangó
  { tmdbId: 44012, type: 'movie' },  // Jeanne Dielman
  { tmdbId: 593, type: 'movie' },    // Solaris
  { tmdbId: 8967, type: 'movie' },   // El árbol de la vida
  { tmdbId: 62, type: 'movie' },     // 2001: Una odisea del espacio
  { tmdbId: 4024, type: 'movie' },   // El año pasado en Marienbad
  { tmdbId: 1956, type: 'movie' },   // Gerry
  { tmdbId: 81401, type: 'movie' },  // El caballo de Turín
  { tmdbId: 3175, type: 'movie' },   // Barry Lyndon
  { tmdbId: 1920, type: 'series' },  // Twin Peaks
  { tmdbId: 54344, type: 'series' }, // The Leftovers
]
