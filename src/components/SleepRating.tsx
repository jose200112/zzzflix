import type { Rating } from '../data/rating'
import './SleepRating.css'

type SleepRatingProps = {
  rating: Rating | null
}

function SleepRating({ rating }: SleepRatingProps) {
  const filled = rating ? Math.min(5, Math.max(1, Math.round(rating.average))) : 0

  let label = 'Sin valorar'
  let aria = 'Sin valorar'
  if (rating) {
    const avg = rating.average.toLocaleString('es-ES', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
    const votes = `${rating.count} ${rating.count === 1 ? 'voto' : 'votos'}`
    label = `${avg} · ${votes}`
    aria = `Nivel de soporífero: ${avg} de 5, ${votes}`
  }

  return (
    <p className="sleep" aria-label={aria}>
      {'💤'.repeat(filled)}
      <span className="sleep-off">{'💤'.repeat(5 - filled)}</span>
      <span className="sleep-label">{label}</span>
    </p>
  )
}

export default SleepRating
