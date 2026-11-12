import type { CardForm } from '../api/orders'

/** Groups digits in fours as people read them: "4242 4242 4242 4242". */
export const formatCardNumber = (input: string) =>
  input
    .replace(/\D/g, '')
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ')

/**
 * Inserts the slash in MM/YY as the digits are typed. A month typed as one digit gets its leading
 * zero: "4" can only be April, and "1/" means January.
 */
export function formatExpiry(input: string): string {
  let digits = input.replace(/\D/g, '')
  if (/^[2-9]/.test(digits) || /^\d\D/.test(input.trimStart())) digits = `0${digits}`
  digits = digits.slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
}

export function luhnValid(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1 && (d *= 2) > 9) d -= 9
    sum += d
  }
  return digits.length > 0 && sum % 10 === 0
}

/** Same checks as the server, so most mistakes show before submitting. Returns errors by field. */
export function validateCard(card: CardForm, now = new Date()): Partial<Record<keyof CardForm, string>> {
  const errors: Partial<Record<keyof CardForm, string>> = {}
  if (!card.name.trim()) errors.name = 'Enter the name on the card.'

  const digits = card.number.replace(/[\s-]/g, '')
  if (!/^\d{12,19}$/.test(digits) || !luhnValid(digits)) errors.number = 'Enter a valid card number.'

  const m = /^(\d{2})\/(\d{2})$/.exec(card.expiry.trim())
  const month = m ? Number(m[1]) : 0
  if (!m || month < 1 || month > 12) {
    errors.expiry = 'Enter the expiry date as MM/YY.'
  } else if (now >= new Date(Date.UTC(2000 + Number(m[2]), month, 1))) {
    errors.expiry = 'This card has expired.'
  }

  if (!/^\d{3}$/.test(card.cvc.trim())) errors.cvc = 'Enter the 3-digit security code.'
  return errors
}

export const TEST_CARDS = [
  { number: '4242 4242 4242 4242', outcome: 'Payment succeeds' },
  { number: '4000 0000 0000 0002', outcome: 'Card is declined' },
  { number: '4000 0000 0000 9995', outcome: 'Insufficient funds' },
] as const
