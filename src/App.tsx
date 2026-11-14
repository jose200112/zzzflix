import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar'
import TitleList from './components/TitleList'
import { titles } from './data/titles'

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
    } catch {
      // Storage not available (private mode, quota exceeded): ignore
    }
  }, [favoriteIds])

  const toggleFavorite = (id: number) => {
    setFavoriteIds((current) =>
      current.includes(id)
        ? current.filter((favId) => favId !== id)
        : [...current, id]
    )
  }

  const favorites = titles.filter((t) => favoriteIds.includes(t.id))

  return (
    <BrowserRouter>
      <NavBar />
      <main>
        <h1>zzzflix</h1>
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
        </Routes>
      </main>
    </BrowserRouter>
  )
}

export default App