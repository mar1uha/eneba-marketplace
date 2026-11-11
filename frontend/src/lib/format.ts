import type { Platform, Region } from '../api/types'

const eur = new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' })

export const formatPrice = (cents: number) => eur.format(cents / 100)

export const platformLabels: Record<Platform, string> = {
  steam: 'Steam',
  xbox: 'Xbox Live',
  playstation: 'PlayStation',
  nintendo: 'Nintendo',
  ea_app: 'EA App',
  ubisoft_connect: 'Ubisoft Connect',
  gog: 'GOG',
  epic: 'Epic Games',
}

export const regionLabels: Record<Region, string> = {
  global: 'Global',
  europe: 'Europe',
  north_america: 'North America',
  united_kingdom: 'United Kingdom',
}
