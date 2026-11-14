type TitleCardProps = {
  title: string
  year: number
  isFavorite: boolean
  onToggleFavorite: () => void
}

function TitleCard({ title, year, isFavorite, onToggleFavorite }: TitleCardProps) {
  return (
    <article>
      <h2>{title}</h2>
      <p>{year}</p>
      <button onClick={onToggleFavorite}>
        {isFavorite ? '★ Favorito' : '☆ Añadir a favoritos'}
      </button>
    </article>
  )
}

export default TitleCard