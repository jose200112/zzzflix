const BASE_URL = 'https://api.themoviedb.org/3'
const IMAGE_URL = 'https://image.tmdb.org/t/p/w342'
const token = import.meta.env.VITE_TMDB_TOKEN

export type TmdbTitle = {
  id: number
  title: string
  year: number
  overview: string
  posterUrl: string | null
  runtime: number | null
}

export async function fetchTitle(
  tmdbId: number,
  type: 'movie' | 'series',
): Promise<TmdbTitle> {
  const path = type === 'movie' ? 'movie' : 'tv'

  const res = await fetch(`${BASE_URL}/${path}/${tmdbId}?language=es-ES`, {
    headers: {
      Authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error(`TMDB respondió ${res.status}`)
  }

  const data = await res.json()

  return {
    id: data.id,
    title: data.title ?? data.name,
    year: Number((data.release_date ?? data.first_air_date ?? '0').slice(0, 4)),
    overview: data.overview,
    posterUrl: data.poster_path ? `${IMAGE_URL}${data.poster_path}` : null,
    runtime: data.runtime ?? data.episode_run_time?.[0] ?? null,
  }
}