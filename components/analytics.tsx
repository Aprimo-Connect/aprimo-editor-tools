'use client'

import { Analytics } from '@vercel/analytics/next'

export function AppAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        const path = new URL(event.url).pathname
        if (path === '/' || path.includes('/oauth/callback')) return null
        return event
      }}
    />
  )
}
