import { useEffect, useEffectEvent, useState } from 'react'

export interface Duration {
  days: number
  hours: number
  minutes: number
  seconds: number
}

export function splitDuration(ms: number): Duration {
  const total = Math.max(0, Math.floor(ms / 1000))
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  }
}

/** Milliseconds left until endsAt, measured on the server clock. Calls onExpire once when it reaches zero. */
export function useCountdown(endsAt: string, clockOffsetMs: number, onExpire?: () => void): number {
  const end = Date.parse(endsAt)
  const [remaining, setRemaining] = useState(() => Math.max(0, end - (Date.now() + clockOffsetMs)))
  const expire = useEffectEvent(() => onExpire?.())

  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, end - (Date.now() + clockOffsetMs))
      setRemaining(left)
      if (left === 0) {
        clearInterval(id)
        expire()
      }
    }
    const id = setInterval(tick, 1000)
    tick()
    return () => clearInterval(id)
  }, [end, clockOffsetMs])

  return remaining
}
