import { useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import TitleList from './components/TitleList'
import TitleDetail from './pages/TitleDetail'
import Footer from './components/Footer'
import type { Title } from './data/titles'
import { rankScore } from './data/rating'
import type { Rating } from './data/rating'
import { loadCatalog } from './api/catalog'
import { fetchRatings } from './api/comments'
import HeroLogo from './components/HeroLogo'
import type { Language } from './i18n'
import { useTranslation } from 'react-i18next'

const STORAGE_KEY = 'zzzflix:favorites'

function loadFavorites(): number[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const parsed = saved ? JSON.parse(saved) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function App() {
  const { t, i18n } = useTranslation()
  // El catálogo se vuelve a cargar al cambiar de idioma
  const lang = (i18n.resolvedLanguage ?? 'en') as Language
  const [favoriteIds, setFavoriteIds] = useState<number[]>(loadFavorites)
  const [catalog, setCatalog] = useState<Title[]>([])
  const [ratings, setRatings] = useState<Record<number, Rating>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favoriteIds))
    } catch { }
  }, [favoriteIds])

  useEffect(() => {
    let cancelled = false
    loadCatalog(lang)
      .then((list) => {
        if (cancelled) return
        setCatalog(list)
        setError(false)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [lang])

  // Las notas vienen de la API de comentarios. Si falla, el catálogo sigue
  // funcionando y todo aparece "Sin valorar".
  useEffect(() => {
    fetchRatings()
      .then(setRatings)
      .catch(() => setRatings({}))
  }, [])

  const titles = useMemo(
    () => catalog.map((t) => ({ ...t, rating: ratings[t.id] ?? null })),
    [catalog, ratings],
  )

  const toggleFavorite = (id: number) => {
    setFavoriteIds((current) =>
      current.includes(id)
        ? current.filter((favId) => favId !== id)
        : [...current, id]
    )
  }

  const favorites = titles.filter((t) => favoriteIds.includes(t.id))
  const movies = titles.filter((t) => t.type === 'movie')
  const series = titles.filter((t) => t.type === 'series')

  // Más soporíferas primero. Los títulos sin valorar quedan al final.
  const ranking = [...titles].sort(
    (a, b) =>
      rankScore(b.rating) - rankScore(a.rating) ||
      (b.runtime ?? 0) - (a.runtime ?? 0),
  )

  if (loading) return <p>{t('app.loading')}</p>
  if (error) return <p>{t('app.loadError')}</p>

  return (
    <BrowserRouter>
      <NavBar />
      <main>
        <HeroLogo />
        <Routes>
          <Route
            path="/"
            element={
              <TitleList
                items={titles}
                favoriteIds={favoriteIds}
                onToggleFavorite={toggleFavorite}
              />
            }
          />
          <Route
            path="/favoritos"
            element={
              favorites.length === 0 ? (
                <p>{t('app.noFavorites')}</p>
              ) : (
                <TitleList
                  items={favorites}
                  favoriteIds={favoriteIds}
                  onToggleFavorite={toggleFavorite}
                />
              )
            }
          />
          <Route
            path="/peliculas"
            element={
              <TitleList
                items={movies}
                favoriteIds={favoriteIds}
                onToggleFavorite={toggleFavorite}
              />
            }
          />
          <Route
            path="/series"
            element={
              <TitleList
                items={series}
                favoriteIds={favoriteIds}
                onToggleFavorite={toggleFavorite}
              />
            }
          />
          <Route
            path="/titulo/:id"
            element={
              <TitleDetail
                titles={titles}
                favoriteIds={favoriteIds}
                onToggleFavorite={toggleFavorite}
              />
            }
          />
          <Route
            path="/soporiferas"
            element={
              <TitleList
                items={ranking}
                favoriteIds={favoriteIds}
                onToggleFavorite={toggleFavorite}
              />
            }
          />
        </Routes>
      </main>
      <Footer />
    </BrowserRouter>
  )
}

export default App
