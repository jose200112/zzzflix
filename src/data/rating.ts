// Nota media de un título según los comentarios aprobados.
export type Rating = { count: number; average: number }

// Para el ranking, la media se mezcla con unos "votos virtuales" de valor 1
// (el valor de un título sin valorar). Así una sola nota alta no catapulta
// una película al primer puesto: hacen falta varias notas para subir.
const PRIOR_VOTES = 2

export function rankScore(rating: Rating | null): number {
  if (!rating) return 1
  return (
    (rating.average * rating.count + PRIOR_VOTES) / (rating.count + PRIOR_VOTES)
  )
}
