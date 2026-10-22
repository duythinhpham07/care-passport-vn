'use client'

import { useCallback, useEffect } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'
import { useRouter } from 'next/navigation'
import { useLang, STR } from './lib/i18n'
import LangSwitch from './lib/LangSwitch'

export default function SignInPage() {
  const { login, authenticated } = useTideCloak()
  const router = useRouter()
  const [lang, setLang] = useLang()
  const t = STR[lang]

  const onLogin = useCallback(() => {
    login()
  }, [login])

  useEffect(() => {
    if (authenticated) {
      router.push('/home')
    }
  }, [authenticated])

  return (
    <>
      <div className="signin-lang"><LangSwitch lang={lang} onChange={setLang} /></div>
      <main className="signin">
        <div className="cover" aria-hidden>
          <div className="emblem">✚</div>
          <div>
            <h2>{t.coverTitle}</h2>
            <p>{t.brand}</p>
          </div>
          <div className="lines">{t.coverFoot}</div>
        </div>

        <div className="signin-copy">
          <h1>{t.signinTitle}</h1>
          <p>{t.signinText}</p>
          <button className="btn btn-primary" onClick={onLogin}>{t.signin}</button>
          <p className="fineprint">{t.demoNote}</p>
        </div>
      </main>
    </>
  )
}
