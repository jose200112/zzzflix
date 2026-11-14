import { Link } from 'react-router-dom'

type TitleCardProps = {
  id: number
  title: string
  year: number
  isFavorite: boolean
  onToggleFavorite: () => void
}

function TitleCard({ id, title, year, isFavorite, onToggleFavorite }: TitleCardProps) {
  return (
    <article className="title-card">
      <Link to={`/titulo/${id}`} className="card-link">
        <h2>{title}</h2>
      </Link>
      <p className="year">{year}</p>
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