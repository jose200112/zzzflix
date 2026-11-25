import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Title } from '../data/titles'
import SleepRating from '../components/SleepRating'
import Comments from '../components/Comments'

type TitleDetailProps = {
  titles: Title[]
  favoriteIds: number[]
  onToggleFavorite: (id: number) => void
}

function TitleDetail({ titles, favoriteIds, onToggleFavorite }: TitleDetailProps) {
  const { t } = useTranslation()
  const { id } = useParams()
  const title = titles.find((t) => t.id === Number(id))

  if (!title) {
    return (
      <section className="detail">
        <p>{t('detail.notFound')}</p>
        <Link to="/" className="back-link">{t('detail.backHome')}</Link>
      </section>
    )
  } 

  const isFavorite = favoriteIds.includes(title.id)

  return (
    <section className="detail">
      <Link to="/" className="back-link">{t('detail.back')}</Link>

      <div className="detail-header">
        {title.posterUrl && (
          <img
            className="detail-poster"
            src={title.posterUrl}
            alt={t('card.posterAlt', { title: title.title })}
          />
        )}
        <div>
          <h1>{title.title}</h1>
          <p className="year">
            {title.year} · {title.type === 'movie' ? t('detail.movie') : t('detail.series')}
            {title.runtime ? ` · ${t('card.min', { count: title.runtime })}` : ''}
          </p>
          <SleepRating rating={title.rating} />
          <button
            className={`fav-btn ${isFavorite ? 'active' : ''}`}
            onClick={() => onToggleFavorite(title.id)}
          >
            {isFavorite ? t('card.favorite') : t('card.addFavorite')}
          </button>
        </div>
      </div>

      <h2>{t('detail.synopsis')}</h2>
      <p>{title.overview || t('card.noOverview')}</p>

      <Comments key={title.id} titleId={title.id} />
    </section>
  )
}

export default TitleDetail
