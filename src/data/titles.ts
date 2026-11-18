export type Title = {
  id: number
  title: string
  year: number
  type: 'movie' | 'series'
  overview: string
  posterUrl: string | null
  runtime: number | null
  sleepScore: 1 | 2 | 3 | 4 | 5
}
