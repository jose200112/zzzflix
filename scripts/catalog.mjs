// Catálogo de zzzflix: descarga los datos de TMDB UNA vez y los guarda en
// src/data/catalog.json. La web carga ese fichero, así que ya no llama a TMDB
// desde el navegador (más rápido y sin token público en el frontend).
//
// Uso (desde la raíz del proyecto):
//   npm run catalog                              regenera catalog.json
//   npm run catalog:add -- "Título" 1975 [movie|series]
//                                                busca en TMDB y añade a curated.json
//
// El token se lee de TMDB_TOKEN o de VITE_TMDB_TOKEN (.env.local).

import { readFile, writeFile } from 'node:fs/promises'

const BASE = 'https://api.themoviedb.org/3'
const IMAGE = 'https://image.tmdb.org/t/p/w342'
const CURATED = new URL('../src/data/curated.json', import.meta.url)
const CATALOG = new URL('../src/data/catalog.json', import.meta.url)

const token = process.env.TMDB_TOKEN ?? process.env.VITE_TMDB_TOKEN
if (!token) {
  console.error('Falta el token de TMDB (VITE_TMDB_TOKEN en .env.local).')
  process.exit(1)
}

async function tmdb(path, params = {}) {
  const url = new URL(BASE + path)
  url.searchParams.set('language', 'es-ES')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value))
  }
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`TMDB respondió ${res.status} en ${path}`)
  return res.json()
}

async function readCurated() {
  return JSON.parse(await readFile(CURATED, 'utf8'))
}

async function fetchTitle({ tmdbId, type }) {
  const data = await tmdb(`/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}`)
  return {
    id: data.id,
    title: data.title ?? data.name,
    year: Number((data.release_date ?? data.first_air_date ?? '0').slice(0, 4)),
    type,
    overview: data.overview ?? '',
    posterUrl: data.poster_path ? `${IMAGE}${data.poster_path}` : null,
    runtime: data.runtime ?? data.episode_run_time?.[0] ?? null,
  }
}

async function build() {
  const curated = await readCurated()
  const titles = []
  // De 10 en 10, para no pasarse del límite de peticiones de TMDB
  for (let i = 0; i < curated.length; i += 10) {
    const batch = curated.slice(i, i + 10)
    titles.push(...(await Promise.all(batch.map(fetchTitle))))
  }
  await writeFile(CATALOG, JSON.stringify(titles, null, 2) + '\n')
  console.log(`catalog.json generado con ${titles.length} títulos.`)
}

async function add(args) {
  const [query, yearArg, typeArg = 'movie'] = args
  const year = Number(yearArg)
  if (!query || !Number.isInteger(year) || !['movie', 'series'].includes(typeArg)) {
    console.error('Uso: npm run catalog:add -- "Título" 1975 [movie|series]')
    process.exit(1)
  }

  const isMovie = typeArg === 'movie'
  const data = await tmdb(isMovie ? '/search/movie' : '/search/tv', { query })
  const yearOf = (r) =>
    Number((r.release_date ?? r.first_air_date ?? '0').slice(0, 4))
  // Se acepta un año de diferencia (estrenos de festival frente a estreno general)
  const match = data.results.find((r) => Math.abs(yearOf(r) - year) <= 1)

  if (!match) {
    console.error(`✗ No encuentro "${query}" (${year}). Candidatos de TMDB:`)
    for (const r of data.results.slice(0, 3)) {
      console.error(`  ${r.id} · ${r.title ?? r.name} (${yearOf(r)})`)
    }
    process.exit(1)
  }

  const curated = await readCurated()
  if (curated.some((c) => c.tmdbId === match.id && c.type === typeArg)) {
    console.log(`= Ya estaba: ${match.title ?? match.name} (${yearOf(match)})`)
    return
  }

  curated.push({
    tmdbId: match.id,
    type: typeArg,
    name: match.title ?? match.name,
    year: yearOf(match),
  })
  await writeFile(CURATED, JSON.stringify(curated, null, 2) + '\n')
  console.log(`✓ Añadida: ${match.title ?? match.name} (${yearOf(match)}) [${match.id}]`)
}

const [command = 'build', ...rest] = process.argv.slice(2)
if (command === 'build') await build()
else if (command === 'add') await add(rest)
else {
  console.error(`Comando desconocido: ${command}`)
  process.exit(1)
}
