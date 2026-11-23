import type { Rating } from './rating'

export type Title = {
  id: number
  title: string
  year: number
  type: 'movie' | 'series'
  overview: string
  posterUrl: string | null
  runtime: number | null
  // null = nadie lo ha valorado todavía
  rating: Rating | null
}
