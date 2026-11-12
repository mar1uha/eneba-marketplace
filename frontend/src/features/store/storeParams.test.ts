import { describe, expect, it } from 'vitest'
import { pageWindow } from './pageWindow'
import { emptyFilters, eurosToCents, readFilters, storeUrl, toApiQuery } from './storeParams'

describe('storeParams', () => {
  it('parses euro amounts people type', () => {
    expect(eurosToCents('10')).toBe(1000)
    expect(eurosToCents(' 9.99 ')).toBe(999)
    expect(eurosToCents('9,5')).toBe(950)
    expect(eurosToCents('0')).toBeNull()
    expect(eurosToCents('1.999')).toBeNull()
    expect(eurosToCents('-5')).toBeNull()
    expect(eurosToCents('abc')).toBeNull()
    expect(eurosToCents('20000')).toBeNull()
  })

  it('reads the URL leniently', () => {
    const f = readFilters(new URLSearchParams('q= hades &platform=gog,ps5,gog&region=europe&genre=rpg,Bad!&min_price=50&max_price=20&sort=relevance&page=0'))
    expect(f).toEqual({
      q: 'hades',
      platforms: ['gog'],
      regions: ['europe'],
      genres: ['rpg'],
      minPrice: '20',
      maxPrice: '50',
      sort: 'relevance',
      page: 1,
    })
  })

  it('builds readable store URLs that round-trip', () => {
    const f = { ...emptyFilters, q: 'baldur’s gate', platforms: ['steam' as const, 'gog' as const], minPrice: '9.99', page: 3 }
    const url = storeUrl(f)
    expect(url).toBe('/store?q=baldur%E2%80%99s%20gate&platform=steam,gog&min_price=9.99&page=3')
    expect(readFilters(new URLSearchParams(url.split('?')[1]))).toEqual(f)
    expect(storeUrl(emptyFilters)).toBe('/store')
  })

  it('converts filters to the API query in cents', () => {
    const f = { ...emptyFilters, genres: ['co-op', 'rpg'], maxPrice: '15', sort: 'price_desc' as const, page: 2 }
    expect(toApiQuery(f)).toBe('genre=co-op%2Crpg&max_price_cents=1500&sort=price_desc&page=2')
  })

  it('shows the first, last, and nearby pages', () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(1, 3)).toEqual([1, 2, 3])
    expect(pageWindow(1, 10)).toEqual([1, 2, 'gap', 10])
    expect(pageWindow(4, 10)).toEqual([1, 2, 3, 4, 5, 'gap', 10])
    expect(pageWindow(6, 10)).toEqual([1, 'gap', 5, 6, 7, 'gap', 10])
    expect(pageWindow(10, 10)).toEqual([1, 'gap', 9, 10])
  })
})
