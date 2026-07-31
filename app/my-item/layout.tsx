import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'My Item' }
export default function Layout({ children }: { children: React.ReactNode }) { return <>{children}</> }
