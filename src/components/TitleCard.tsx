import { Link } from 'react-router-dom'
import type { Title } from '../data/titles'
import SleepRating from './SleepRating'

type TitleCardProps = {
  item: Title
  isFavorite: boolean
  onToggleFavorite: () => void
}

function TitleCard({ item, isFavorite, onToggleFavorite }: TitleCardProps) {
  return (
    <article className="title-card">
      <Link to={`/titulo/${item.id}`} className="card-link">
        {item.posterUrl ? (
          <img
            className="poster"
            src={item.posterUrl}
            alt={`Póster de ${item.title}`}
            loading="lazy"
          />
        ) : (
          <div className="poster poster-empty">Sin póster</div>
        )}
        <h2>{item.title}</h2>
      </Link>
      <p className="year">
        {item.year}
        {item.runtime ? ` · ${item.runtime} min` : ''}
      </p>
      <SleepRating rating={item.rating} />
      <p className="overview">{item.overview || 'Sin sinopsis disponible.'}</p>
      <button
        className={`fav-btn ${isFavorite ? 'active' : ''}`}
        onClick={onToggleFavorite}
      >
        {isFavorite ? '★ Favorito' : '☆ Añadir a favoritos'}
      </button>
    </article>
  )
}

export default TitleCard