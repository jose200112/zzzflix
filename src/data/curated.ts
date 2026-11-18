export type CuratedTitle = {
  tmdbId: number
  type: 'movie' | 'series'
  sleepScore: 1 | 2 | 3 | 4 | 5
}

export const curated: CuratedTitle[] = [
  { tmdbId: 1398, type: 'movie', sleepScore: 4 },   // Stalker
  { tmdbId: 31414, type: 'movie', sleepScore: 5 },  // Sátántangó
  { tmdbId: 44012, type: 'movie', sleepScore: 5 },  // Jeanne Dielman
  { tmdbId: 593, type: 'movie', sleepScore: 4 },    // Solaris
  { tmdbId: 8967, type: 'movie', sleepScore: 4 },   // El árbol de la vida
  { tmdbId: 62, type: 'movie', sleepScore: 4 },     // 2001: Una odisea del espacio
  { tmdbId: 4024, type: 'movie', sleepScore: 4 },   // El año pasado en Marienbad
  { tmdbId: 1956, type: 'movie', sleepScore: 5 },   // Gerry
  { tmdbId: 81401, type: 'movie', sleepScore: 5 },  // El caballo de Turín
  { tmdbId: 3175, type: 'movie', sleepScore: 4 },   // Barry Lyndon
  { tmdbId: 1920, type: 'series', sleepScore: 3 },  // Twin Peaks
  { tmdbId: 54344, type: 'series', sleepScore: 2 }, // The Leftovers
]
