import { Link, useParams } from 'react-router-dom'
import { titles } from '../data/titles'

type TitleDetailProps = {
  favoriteIds: number[]
  onToggleFavorite: (id: number) => void
}

function TitleDetail({ favoriteIds, onToggleFavorite }: TitleDetailProps) {
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
      <h1>{title.title}</h1>
      <p className="year">
        {title.year} · {title.type === 'movie' ? 'Película' : 'Serie'}
      </p>
      <button
        className={`fav-btn ${isFavorite ? 'active' : ''}`}
        onClick={() => onToggleFavorite(title.id)}
      >
        {isFavorite ? '★ Favorito' : '☆ Añadir a favoritos'}
      </button>

      <h2>Reseña</h2>
      <p>Próximamente: aquí irá la reseña.</p>

      <h2>Comentarios</h2>
      <p>Próximamente: aquí irán los comentarios.</p>
    </section>
  )
}

export default TitleDetail