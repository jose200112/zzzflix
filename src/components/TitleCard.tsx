import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Title } from '../data/titles'
import SleepRating from './SleepRating'

type TitleCardProps = {
  item: Title
  isFavorite: boolean
  onToggleFavorite: () => void
}

function TitleCard({ item, isFavorite, onToggleFavorite }: TitleCardProps) {
  const { t } = useTranslation()
  return (
    <article className="title-card">
      <Link to={`/titulo/${item.id}`} className="card-link">
        {item.posterUrl ? (
          <img
            className="poster"
            src={item.posterUrl}
            alt={t('card.posterAlt', { title: item.title })}
            loading="lazy"
          />
        ) : (
          <div className="poster poster-empty">{t('card.noPoster')}</div>
        )}
        <h2>{item.title}</h2>
      </Link>
      <p className="year">
        {item.year}
        {item.runtime ? ` · ${t('card.min', { count: item.runtime })}` : ''}
      </p>
      <SleepRating rating={item.rating} />
      <p className="overview">{item.overview || t('card.noOverview')}</p>
      <button
        className={`fav-btn ${isFavorite ? 'active' : ''}`}
        onClick={onToggleFavorite}
      >
        {isFavorite ? t('card.favorite') : t('card.addFavorite')}
      </button>
    </article>
  )
}

export default TitleCard
