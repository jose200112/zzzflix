import { Link, useParams } from 'react-router-dom'
import type { Title } from '../data/titles'
import SleepRating from '../components/SleepRating'

type TitleDetailProps = {
  titles: Title[]
  favoriteIds: number[]
  onToggleFavorite: (id: number) => void
}

function TitleDetail({ titles, favoriteIds, onToggleFavorite }: TitleDetailProps) {
  const { id } = useParams()
  const title = titles.find((t) => t.id === Number(id))

  if (!title) {
    return (
      <section className="detail">
        <p>Este título no existe.</p>
        <Link to="/" className="back-link">← Volver al inicio</Link>
      </section>
    )
  }

  const isFavorite = favoriteIds.includes(title.id)

  return (
    <section className="detail">
      <Link to="/" className="back-link">← Volver</Link>

      <div className="detail-header">
        {title.posterUrl && (
          <img
            className="detail-poster"
            src={title.posterUrl}
            alt={`Póster de ${title.title}`}
          />
        )}
        <div>
          <h1>{title.title}</h1>
          <p className="year">
            {title.year} · {title.type === 'movie' ? 'Película' : 'Serie'}
            {title.runtime ? ` · ${title.runtime} min` : ''}
          </p>
          <SleepRating score={title.sleepScore} />
          <button
            className={`fav-btn ${isFavorite ? 'active' : ''}`}
            onClick={() => onToggleFavorite(title.id)}
          >
            {isFavorite ? '★ Favorito' : '☆ Añadir a favoritos'}
          </button>
        </div>
      </div>

      <h2>Sinopsis</h2>
      <p>{title.overview || 'Sin sinopsis disponible.'}</p>

      <h2>Comentarios</h2>
      <p>Próximamente: aquí irán los comentarios.</p>
    </section>
  )
}

export default TitleDetail