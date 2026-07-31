import type { Metadata } from 'next'
import { Roboto } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from 'sonner'
import { AprimoProvider } from '@/context/aprimo-context'
import { AprimoConfigDialog } from '@/components/aprimo-config-dialog'
import { AprimoSettingsBar } from '@/components/aprimo-settings-bar'
import { ThemeProvider } from '@/components/theme-provider'
import './globals.css'

const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: '--font-sans',
})


export const metadata: Metadata = {
  title: {
    default: 'Aprimo Editor Tools',
    template: 'Aprimo Editor Tools | %s',
  },
  description: 'Connect and manage your Aprimo DAM environment',
  generator: 'v0.app',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/icons/apple-touch-icon.svg',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={roboto.variable} suppressHydrationWarning>
      <body className="font-sans antialiased bg-background">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <AprimoProvider>
            <AprimoConfigDialog />
            <AprimoSettingsBar />
            {children}
          </AprimoProvider>
          <Toaster position="top-right" richColors offset="88px" />
          {process.env.NODE_ENV === 'production' && <Analytics />}
        </ThemeProvider>
      </body>
    </html>
  )
}
