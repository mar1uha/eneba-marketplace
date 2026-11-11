import type { ReactNode } from 'react'
import { Link } from 'react-router'

interface Props {
  href: string
  className?: string
  children: ReactNode
}

/** Link targets come from the CMS-style homepage config, so they may be internal routes or external URLs. */
export function SmartLink({ href, className, children }: Props) {
  if (href.startsWith('/')) {
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    )
  }
  return (
    <a href={href} className={className} rel="noopener noreferrer">
      {children}
    </a>
  )
}
