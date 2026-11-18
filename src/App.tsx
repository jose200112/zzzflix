import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import TitleList from './components/TitleList'
import { titles } from './data/titles'
import logo from './assets/logo-zzzflix.png'
import TitleDetail from './pages/TitleDetail'
import Footer from './components/Footer'

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
  const [favoriteIds, setFavoriteIds] = useState<number[]>(loadFavorites)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(favoriteIds))
    } catch { }
  }, [favoriteIds])

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

  return (
    <BrowserRouter>
      <NavBar />
      <main>
        <img src={logo} alt="zzzflix" className="hero-logo" />
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
                <p>Aún no tienes favoritos.</p>
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
            element={<TitleDetail favoriteIds={favoriteIds} onToggleFavorite={toggleFavorite} />}
          />
        </Routes>
      </main>
      <Footer />
    </BrowserRouter>
  )
}

export default App