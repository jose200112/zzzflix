import TitleCard from './TitleCard'
import type { Title } from '../data/titles'

type TitleListProps = {
  items: Title[]
  favoriteIds: number[]
  onToggleFavorite: (id: number) => void
}

function TitleList({ items, favoriteIds, onToggleFavorite }: TitleListProps) {
  return (
    <>
      {items.map((t) => (
        <TitleCard
          key={t.id}
          title={t.title}
          year={t.year}
          isFavorite={favoriteIds.includes(t.id)}
          onToggleFavorite={() => onToggleFavorite(t.id)}
        />
      ))}
    </>
  )
}

export default TitleList