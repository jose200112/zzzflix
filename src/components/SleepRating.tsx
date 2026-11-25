import { useTranslation } from 'react-i18next'
import { useLocale } from '../i18n'
import type { Rating } from '../data/rating'
import './SleepRating.css'

type SleepRatingProps = {
  rating: Rating | null
}

function SleepRating({ rating }: SleepRatingProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const filled = rating ? Math.min(5, Math.max(1, Math.round(rating.average))) : 0

  let label = t('rating.unrated')
  let aria = label
  if (rating) {
    const avg = rating.average.toLocaleString(locale, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })
    const votes = t('rating.votes', { count: rating.count })
    label = `${avg} · ${votes}`
    aria = t('rating.aria', { avg, votes })
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
