import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import TitleCard from './TitleCard'
import type { Title } from '../data/titles'
import './TitleList.css'

type TitleListProps = {
  items: Title[]
  favoriteIds: number[]
  onToggleFavorite: (id: number) => void
}

const PAGE_SIZE = 20 // 4 filas de 5 tarjetas

// Para buscar sin importar mayúsculas ni tildes ("sueno" encuentra "Sueño")
const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

// Números de página a mostrar: primera, última y las vecinas de la actual
function pageNumbers(current: number, total: number): (number | '…')[] {
  const wanted = new Set([1, total, current - 1, current, current + 1])
  const pages = [...wanted].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b)
  const out: (number | '…')[] = []
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push('…')
    out.push(p)
  })
  return out
}

function TitleList({ items, favoriteIds, onToggleFavorite }: TitleListProps) {
  const { t } = useTranslation()
  // La búsqueda y la página viven en la URL: el botón Atrás y los enlaces
  // compartidos funcionan, y cada pestaña empieza desde cero.
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''

  const needle = normalize(query.trim())
  const filtered = needle
    ? items.filter((t) => normalize(`${t.title} ${t.year}`).includes(needle))
    : items

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, Number(params.get('pagina')) || 1), totalPages)
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function update(next: { q?: string; pagina?: number }) {
    const merged = new URLSearchParams(params)
    if (next.q !== undefined) {
      if (next.q) merged.set('q', next.q)
      else merged.delete('q')
      merged.delete('pagina') // al buscar, se vuelve a la primera página
    }
    if (next.pagina !== undefined) {
      if (next.pagina > 1) merged.set('pagina', String(next.pagina))
      else merged.delete('pagina')
    }
    // "replace" en la búsqueda: cada letra no añade una entrada al historial
    setParams(merged, { replace: next.q !== undefined })
  }

  function goTo(p: number) {
    update({ pagina: p })
    window.scrollTo({ top: 0 })
  }

  return (
    <div className="title-list">
      <div className="list-toolbar">
        <input
          type="search"
          className="list-search"
          placeholder={t('list.searchPlaceholder')}
          aria-label={t('list.searchLabel')}
          value={query}
          onChange={(e) => update({ q: e.target.value })}
        />
        <span className="list-count">
          {t('list.count', { count: filtered.length })}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p>{t('list.noResults', { query })}</p>
      ) : (
        <div className="title-grid">
          {visible.map((t) => (
            <TitleCard
              key={t.id}
              item={t}
              isFavorite={favoriteIds.includes(t.id)}
              onToggleFavorite={() => onToggleFavorite(t.id)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav className="pagination" aria-label={t('list.pagination')}>
          <button disabled={page === 1} onClick={() => goTo(page - 1)}>
            {t('list.prev')}
          </button>
          {pageNumbers(page, totalPages).map((p, i) =>
            p === '…' ? (
              <span key={`gap-${i}`} className="page-gap">
                …
              </span>
            ) : (
              <button
                key={p}
                className={p === page ? 'current' : ''}
                aria-current={p === page ? 'page' : undefined}
                onClick={() => goTo(p)}
              >
                {p}
              </button>
            ),
          )}
          <button disabled={page === totalPages} onClick={() => goTo(page + 1)}>
            {t('list.next')}
          </button>
        </nav>
      )}
    </div>
  )
}

export default TitleList
