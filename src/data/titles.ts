export type Title = {
  id: number
  title: string
  year: number
  type: 'movie' | 'series'
}

export const titles: Title[] = [
  { id: 1, title: 'Elephants Dream', year: 2006, type: 'movie' },
  { id: 2, title: 'Big Buck Bunny', year: 2008, type: 'movie' },
  { id: 3, title: 'Sintel', year: 2010, type: 'movie' },
  { id: 4, title: 'Tears of Steel', year: 2012, type: 'movie' },
  { id: 5, title: 'Cosmos Laundromat', year: 2015, type: 'movie' },
  { id: 6, title: 'Spring', year: 2019, type: 'movie' },
  { id: 7, title: 'Noches de Insomnio', year: 2019, type: 'series' },
  { id: 8, title: 'La Siesta Eterna', year: 2022, type: 'series' },
]