import { describe, expect, it } from 'vitest'
import { splitDuration } from '../features/home/useCountdown'
import { formatPrice } from './format'

describe('formatPrice', () => {
  it('formats integer cents as euros', () => {
    expect(formatPrice(2759)).toBe('€27.59')
    expect(formatPrice(99)).toBe('€0.99')
    expect(formatPrice(123456)).toBe('€1,234.56')
  })
})

describe('splitDuration', () => {
  it('splits milliseconds into days, hours, minutes, seconds', () => {
    expect(splitDuration(((26 * 60 + 3) * 60 + 9) * 1000 + 999)).toEqual({ days: 1, hours: 2, minutes: 3, seconds: 9 })
  })

  it('clamps negative values to zero', () => {
    expect(splitDuration(-5000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  })
})
