'use client'

import { useCallback, useEffect } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'
import { useRouter } from 'next/navigation'

export default function SignInPage() {
  const { login, authenticated } = useTideCloak()
  const router = useRouter()

  const onLogin = useCallback(() => {
    login()
  }, [login])

  useEffect(() => {
    if (authenticated) {
      router.push('/home')
    }
  }, [authenticated])

  return (
    <main className="signin">
      <div className="cover" aria-hidden>
        <div className="emblem">✚</div>
        <div>
          <h2>Sổ khám bệnh</h2>
          <p>Care Passport VN</p>
        </div>
        <div className="lines">Held by the patient. Sealed by Tide.</div>
      </div>

      <div className="signin-copy">
        <h1>Your health record should open only for you.</h1>
        <p>
          Hospitals keep your history, but they shouldn&apos;t be able to read it without you. Care Passport seals every entry
          with a key that no admin, insurer or AI holds.
        </p>
        <button className="btn btn-primary" onClick={onLogin}>Sign in with Tide</button>
        <p className="fineprint">Demo build with synthetic records only.</p>
      </div>
    </main>
  )
}
