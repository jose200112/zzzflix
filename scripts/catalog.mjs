// Catálogo de zzzflix: descarga los datos de TMDB UNA vez y los guarda en
// src/data/catalog/ (base.json con los datos comunes y un archivo por idioma:
// es.json, en.json, de.json). La web carga esos ficheros, así que ya no llama a
// TMDB desde el navegador (más rápido y sin token público en el frontend).
//
// Uso (desde la raíz del proyecto):
//   npm run catalog                              regenera src/data/catalog/
//   npm run catalog:add -- "Título" 1975 [movie|series]
//                                                busca en TMDB y añade a curated.json
//   npm run catalog:discover [-- --pages 15 --limit 250 --min-runtime 140
//                               --min-votes 150 --max-votes 6000 --min-rating 6.8]
//                                                propone películas largas y bien valoradas
//                                                (src/data/discovered.json). Lo que hay
//                                                en curated.json siempre tiene prioridad.
//
// El token se lee de TMDB_TOKEN o de VITE_TMDB_TOKEN (.env.local).

import { mkdir, readFile, writeFile } from 'node:fs/promises'

const BASE = 'https://api.themoviedb.org/3'
const IMAGE = 'https://image.tmdb.org/t/p/w342'
const CURATED = new URL('../src/data/curated.json', import.meta.url)
const DISCOVERED = new URL('../src/data/discovered.json', import.meta.url)
const CATALOG_DIR = new URL('../src/data/catalog/', import.meta.url)

// Idiomas de la web y su código en TMDB. Si TMDB no tiene la sinopsis o el
// póster en un idioma, se usa el primero que exista en este orden de respaldo.
const LANGS = { es: 'es-ES', en: 'en-US', de: 'de-DE' }
const FALLBACK = {
  es: ['es', 'en', 'de'],
  en: ['en', 'es', 'de'],
  de: ['de', 'en', 'es'],
}

const token = process.env.TMDB_TOKEN ?? process.env.VITE_TMDB_TOKEN
if (!token) {
  console.error('Falta el token de TMDB (VITE_TMDB_TOKEN en .env.local).')
  process.exit(1)
}

async function tmdb(path, params = {}, language = 'es-ES') {
  const url = new URL(BASE + path)
  url.searchParams.set('language', language)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value))
  }
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    })
    // Si TMDB frena (429), se espera lo que pide y se reintenta
    if (res.status === 429 && attempt < 4) {
      const asked = Number(res.headers.get('retry-after'))
      const seconds = Number.isFinite(asked) && asked > 0 ? asked : 2
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
      continue
    }
    if (!res.ok) throw new Error(`TMDB respondió ${res.status} en ${path}`)
    return res.json()
  }
}

async function readJson(url) {
  try {
    return JSON.parse(await readFile(url, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}

const readCurated = () => readJson(CURATED)
const keyOf = (c) => `${c.type}:${c.tmdbId}`

// Los descubiertos se vuelven a comprobar con los datos reales de la ficha:
// el filtro de duración de TMDB no siempre coincide, y sin sinopsis en
// español la tarjeta queda vacía. Los de curated.json entran siempre.
const MIN_DISCOVERED_RUNTIME = 140

// Pide la ficha en los tres idiomas. Los datos comunes salen de la ficha en
// español; los textos de cada idioma, con respaldo si falta alguno.
async function fetchTitle({ tmdbId, type }) {
  const path = `/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}`
  const codes = Object.keys(LANGS)
  const sheets = Object.fromEntries(
    await Promise.all(codes.map(async (c) => [c, await tmdb(path, {}, LANGS[c])])),
  )
  const es = sheets.es

  const base = {
    id: es.id,
    year: Number((es.release_date ?? es.first_air_date ?? '0').slice(0, 4)),
    type,
    runtime: es.runtime ?? es.episode_run_time?.[0] ?? null,
  }

  const texts = {}
  const fellBack = []
  for (const code of codes) {
    const first = (read) => FALLBACK[code].map((c) => read(sheets[c])).find(Boolean)
    const overview = first((d) => d.overview) ?? ''
    const poster = first((d) => d.poster_path)
    texts[code] = {
      title: sheets[code].title ?? sheets[code].name,
      overview,
      posterUrl: poster ? `${IMAGE}${poster}` : null,
    }
    if (!sheets[code].overview && overview) fellBack.push(code)
  }
  return { base, texts, fellBack, spanishOverview: es.overview ?? '' }
}

async function build() {
  // La lista manual va primero y manda sobre lo descubierto
  const curated = await readCurated()
  const seen = new Set(curated.map(keyOf))
  const discovered = (await readJson(DISCOVERED)).filter((d) => !seen.has(keyOf(d)))
  const all = [...curated, ...discovered]

  const fetched = []
  // De 5 en 5 (cada título son 3 peticiones), para no pasarse del límite de TMDB
  for (let i = 0; i < all.length; i += 5) {
    const batch = all.slice(i, i + 5)
    fetched.push(...(await Promise.all(batch.map(fetchTitle))))
  }
  // El filtro sigue siendo el de siempre: sinopsis en español y duración mínima
  const kept = fetched.filter(
    (t, i) =>
      i < curated.length ||
      (t.spanishOverview && (t.base.runtime ?? 0) >= MIN_DISCOVERED_RUNTIME),
  )
  const dropped = fetched.length - kept.length

  await mkdir(CATALOG_DIR, { recursive: true })
  const save = (name, data) =>
    writeFile(new URL(`${name}.json`, CATALOG_DIR), JSON.stringify(data, null, 2) + '\n')
  await save('base', kept.map((t) => t.base))
  for (const code of Object.keys(LANGS)) {
    await save(code, Object.fromEntries(kept.map((t) => [t.base.id, t.texts[code]])))
  }

  console.log(
    `catalog/ generado con ${kept.length} títulos ` +
      `(${curated.length} manuales + ${kept.length - curated.length} descubiertos; ` +
      `${dropped} descartados por duración o sin sinopsis).`,
  )
  for (const code of Object.keys(LANGS)) {
    const used = kept.filter((t) => t.fellBack.includes(code)).length
    const empty = kept.filter((t) => !t.texts[code].overview).length
    console.log(`  ${code}: ${used} sinopsis tomadas de otro idioma, ${empty} sin sinopsis`)
  }
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

function numberFlag(args, name, fallback) {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return fallback
  const value = Number(args[i + 1])
  if (!Number.isFinite(value)) {
    console.error(`Valor no válido para --${name}`)
    process.exit(1)
  }
  return value
}

// Propone películas largas, bien valoradas y de público medio (sin blockbusters)
async function discover(args) {
  const pages = numberFlag(args, 'pages', 15)
  const limit = numberFlag(args, 'limit', 250)
  const params = {
    include_adult: false,
    sort_by: 'vote_average.desc',
    'with_runtime.gte': numberFlag(args, 'min-runtime', 140),
    'vote_count.gte': numberFlag(args, 'min-votes', 150),
    'vote_count.lte': numberFlag(args, 'max-votes', 6000),
    'vote_average.gte': numberFlag(args, 'min-rating', 6.8),
    // acción, aventura, animación, familiar y película de TV
    without_genres: '28,12,16,10751,10770',
  }

  const curated = await readCurated()
  const taken = new Set(curated.map(keyOf))
  const found = []

  for (let page = 1; page <= pages && found.length < limit; page++) {
    const data = await tmdb('/discover/movie', { ...params, page })
    for (const r of data.results) {
      const entry = {
        tmdbId: r.id,
        type: 'movie',
        name: r.title,
        year: Number((r.release_date ?? '0').slice(0, 4)),
      }
      // Sin póster la tarjeta queda fea: se descarta
      if (!r.poster_path || taken.has(keyOf(entry))) continue
      taken.add(keyOf(entry))
      found.push(entry)
    }
    if (page >= data.total_pages) break
  }

  const result = found.slice(0, limit)
  await writeFile(DISCOVERED, JSON.stringify(result, null, 2) + '\n')
  console.log(`discovered.json: ${result.length} películas propuestas. Las primeras:`)
  for (const e of result.slice(0, 15)) console.log(`  ${e.name} (${e.year})`)
  console.log('Revisa src/data/discovered.json y lanza "npm run catalog".')
}

const [command = 'build', ...rest] = process.argv.slice(2)
if (command === 'build') await build()
else if (command === 'add') await add(rest)
else if (command === 'discover') await discover(rest)
else {
  console.error(`Comando desconocido: ${command}`)
  process.exit(1)
}
