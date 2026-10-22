import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import {
  TideCloakProvider
} from '@tidecloak/nextjs'
import tcConfig from '../tidecloak.json'


export const metadata: Metadata = {
  title: 'Care Passport VN',
  description: 'Patient-held health records with TideCloak',
}

interface RootLayoutProps {
  children: ReactNode
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <TideCloakProvider config={tcConfig}>
          {children}
        </TideCloakProvider>
      </body>
    </html>
  )
}
