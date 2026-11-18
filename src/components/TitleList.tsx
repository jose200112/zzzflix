import TitleCard from './TitleCard'
import type { Title } from '../data/titles'

type TitleListProps = {
  items: Title[]
  favoriteIds: number[]
  onToggleFavorite: (id: number) => void
}

function TitleList({ items, favoriteIds, onToggleFavorite }: TitleListProps) {
  return (
    <div className="title-grid">
      {items.map((t) => (
        <TitleCard
          key={t.id}
          item={t}
          isFavorite={favoriteIds.includes(t.id)}
          onToggleFavorite={() => onToggleFavorite(t.id)}
        />
      ))}
    </div>
  )
}

export default TitleList