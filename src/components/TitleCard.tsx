type TitleCardProps = {
  title: string
  year: number
  isFavorite: boolean
  onToggleFavorite: () => void
}

function TitleCard({ title, year, isFavorite, onToggleFavorite }: TitleCardProps) {
  return (
    <article className="title-card">
      <h2>{title}</h2>
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