'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useLang, STR, SAMPLES } from '../lib/i18n'
import LangSwitch from '../lib/LangSwitch'

// Entries are encrypted under the patient's own Tide identity. The tag matches the
// _tide_message.selfencrypt/.selfdecrypt roles provisioned in init/realm.json.
const TAG = 'message'

type Kind = 'allergy' | 'condition' | 'medication' | 'lab' | 'visit'
type Entry = { kind: Kind; title: string; date: string; facility: string; detail: string }
type Rec = { id: string; createdAt: string; ciphertext: string; entry?: Entry; broken?: boolean }
type Sealed = { id: string; owner: string; createdAt: string; ciphertext: string }
type Actor = 'you' | 'admin' | 'ai' | 'doctor'
type EventKind = 'added' | 'exported' | 'ai_denied' | 'ai_read' | 'granted' | 'revoked'
type LogEvent = { id: string; at: string; actor: Actor; event: EventKind; count: number; until?: string }
type Recipient = 'doctor' | 'ai'
type Grant = { to: Recipient; ids: string[]; until: number; span: number; flags?: string[] }

const KIND_ORDER: Kind[] = ['allergy', 'condition', 'medication', 'lab', 'visit']
const DURATIONS = [15 * 60e3, 60 * 60e3, 24 * 60 * 60e3]
const OUTCOME: Record<EventKind, 'sealed' | 'denied' | 'granted' | 'revoked' | 'saved'> = {
  added: 'saved', exported: 'sealed', ai_denied: 'denied', ai_read: 'granted', granted: 'granted', revoked: 'revoked',
}

const blank = (): Entry => ({ kind: 'visit', title: '', date: new Date().toISOString().slice(0, 10), facility: '', detail: '' })

function parse(plain: string): Entry {
  try {
    const e = JSON.parse(plain)
    if (e && KIND_ORDER.includes(e.kind)) return e
  } catch {}
  return { kind: 'visit', title: plain.slice(0, 60), date: new Date().toISOString().slice(0, 10), facility: '', detail: plain }
}

// Sample entries are stored in whichever language was active when they were loaded;
// show them in the current one so the page never mixes languages.
function localize(e: Entry, lang: 'vi' | 'en'): Entry {
  for (const l of ['vi', 'en'] as const) {
    const i = SAMPLES[l].findIndex(s => s.title === e.title && s.date === e.date)
    if (i >= 0) return { ...SAMPLES[lang][i] } as Entry
  }
  return e
}

const ICON_PATHS: Record<Kind | 'lock' | 'ai' | 'check' | 'eye', string> = {
  allergy: 'M12 3l9 16H3zM12 10v4M12 16.5v.5',
  condition: 'M3 12h4l2-5 4 10 2-5h6',
  medication: 'M4.9 12.1l7.2-7.2a4.5 4.5 0 016.4 6.4l-7.2 7.2a4.5 4.5 0 01-6.4-6.4zM8.5 8.5l7 7',
  lab: 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3M7.5 15h9',
  visit: 'M7 4h10a2 2 0 012 2v13a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2zM9 3h6v3H9zM9 11h6M9 15h4',
  lock: 'M6 11h12a1 1 0 011 1v8a1 1 0 01-1 1H6a1 1 0 01-1-1v-8a1 1 0 011-1zM8 11V7a4 4 0 018 0v4M12 15v2',
  ai: 'M8 7h8a1 1 0 011 1v8a1 1 0 01-1 1H8a1 1 0 01-1-1V8a1 1 0 011-1zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  eye: 'M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12zM12 9.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5z',
}
const Icon = ({ name, size = 18 }: { name: keyof typeof ICON_PATHS; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={ICON_PATHS[name]} />
  </svg>
)

export default function CarePassport() {
  const { logout, getValueFromIdToken, token, doEncrypt, doDecrypt, authenticated, isInitializing } = useTideCloak()
  const [lang, setLang] = useLang()
  const t = STR[lang]
  const locale = lang === 'vi' ? 'vi-VN' : 'en-GB'
  const dmy = (d: string) => new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' })
  const hm = (d: string | number) => new Date(d).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  const [name, setName] = useState('')
  const [vuid, setVuid] = useState('')
  const [recs, setRecs] = useState<Rec[]>([])
  const [loaded, setLoaded] = useState(false)
  const [log, setLog] = useState<LogEvent[]>([])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [fresh, setFresh] = useState<Set<string>>(new Set())

  const [draft, setDraft] = useState<Entry>(blank)
  const dialog = useRef<HTMLDialogElement>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [to, setTo] = useState<Recipient>('doctor')
  const [duration, setDuration] = useState(DURATIONS[0])
  const [grant, setGrant] = useState<Grant | null>(null)
  const [now, setNow] = useState(Date.now())

  const [probe, setProbe] = useState<{ kind: 'admin'; rows: Sealed[] } | { kind: 'ai'; attempted: number } | null>(null)

  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])
  const say = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2600) }

  const fail = async (res: Response) => {
    const code = (await res.json().catch(() => ({}))).error
    if (code === 'session') return lang === 'vi' ? 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' : 'Your session expired. Sign in again.'
    return lang === 'vi' ? `Máy chủ từ chối yêu cầu (HTTP ${res.status}). Hãy thử lại.` : `The server refused the request (HTTP ${res.status}). Try again.`
  }

  const refreshLog = useCallback(async () => {
    const res = await fetch('/api/access-log', { headers: auth })
    if (res.ok) setLog(await res.json())
  }, [auth])

  const load = useCallback(async () => {
    const res = await fetch('/api/records', { headers: auth })
    if (!res.ok) throw new Error(await fail(res))
    const list: Rec[] = await res.json()
    // Decrypt in the browser, one at a time: concurrent doDecrypt calls mix up their results,
    // and separate calls keep a single bad entry from hiding the rest.
    const out: Rec[] = []
    for (const r of list) {
      try {
        const [plain] = await doDecrypt([{ encrypted: r.ciphertext, tags: [TAG] }])
        out.push({ ...r, entry: parse(String(plain)) })
      } catch {
        out.push({ ...r, broken: true })
      }
    }
    setRecs(out)
    setLoaded(true)
    return out
  }, [auth, doDecrypt, lang])

  useEffect(() => {
    if (!isInitializing && !authenticated) window.location.replace('/')
  }, [isInitializing, authenticated])

  useEffect(() => {
    if (!token) return
    setName(getValueFromIdToken('preferred_username'))
    setVuid(String(getValueFromIdToken('vuid') || ''))
    load().catch(e => setErr(String(e?.message || e)))
    refreshLog()
  }, [token])

  // grant countdown
  useEffect(() => {
    if (!grant) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [grant])
  useEffect(() => { if (grant && now > grant.until) setGrant(null) }, [now, grant])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr('')
    try { await fn() } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy('') }
  }

  const seal = async (entries: Entry[]) => {
    const cts = await doEncrypt(entries.map(e => ({ data: JSON.stringify(e), tags: [TAG] })))
    for (const ct of cts) {
      const res = await fetch('/api/records', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ ciphertext: ct }) })
      if (!res.ok) throw new Error(await fail(res))
    }
    const before = new Set(recs.map(r => r.id))
    const [out] = await Promise.all([load(), refreshLog()])
    setFresh(new Set(out.filter(r => !before.has(r.id)).map(r => r.id)))
    setTimeout(() => setFresh(new Set()), 2400)
  }

  const saveDraft = () => run('save', async () => {
    await seal([{ ...draft, title: draft.title.trim(), facility: draft.facility.trim(), detail: draft.detail.trim() }])
    dialog.current?.close()
    setDraft(blank())
    say(t.toastSaved)
  })

  const loadSamples = () => run('samples', async () => {
    await seal(SAMPLES[lang] as unknown as Entry[])
    say(t.toastSamples(SAMPLES[lang].length))
  })

  const openAsAdmin = () => run('admin', async () => {
    const rows: Sealed[] = await (await fetch('/api/hospital-db')).json()
    setProbe({ kind: 'admin', rows })
    await refreshLog()
  })

  const aiWithoutConsent = () => run('ai', async () => {
    const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'server' }) })
    setProbe({ kind: 'ai', attempted: (await res.json()).attempted })
    await refreshLog()
  })

  const shareSelected = () => run('share', async () => {
    const chosen = view.filter(r => selected.has(r.id) && r.entry)
    const until = Date.now() + duration
    let flags: string[] | undefined
    if (to === 'ai') {
      const texts = chosen.map(r => `${r.entry!.title}. ${r.entry!.detail}`)
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'consent', texts }) })
      flags = (await res.json()).flags
    } else {
      await fetch('/api/access-log', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: 'doctor', event: 'granted', count: chosen.length, until: new Date(until).toISOString() }) })
    }
    setGrant({ to, ids: chosen.map(r => r.id), until, span: duration, flags })
    setNow(Date.now())
    await refreshLog()
    const who = t.recipients[to].name
    say(t.toastShared(chosen.length, to === 'ai' ? who : who.toLowerCase()))
  })

  const revoke = () => run('revoke', async () => {
    if (!grant) return
    await fetch('/api/access-log', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: grant.to, event: 'revoked' }) })
    setGrant(null)
    setSelected(new Set())
    await refreshLog()
    say(t.toastRevoked)
  })

  const toggle = (id: string) => setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const view = useMemo(() => recs.map(r => r.entry ? { ...r, entry: localize(r.entry, lang) } : r), [recs, lang])
  const byYear = useMemo(() => {
    const sorted = view.filter(r => r.entry).sort((a, b) => b.entry!.date.localeCompare(a.entry!.date))
    const groups: [string, Rec[]][] = []
    for (const r of sorted) {
      const y = r.entry!.date.slice(0, 4)
      if (!groups.length || groups[groups.length - 1][0] !== y) groups.push([y, []])
      groups[groups.length - 1][1].push(r)
    }
    return groups
  }, [view])
  const broken = recs.filter(r => r.broken).length
  const grantedEntries = grant ? view.filter(r => grant.ids.includes(r.id) && r.entry) : []
  const left = grant ? Math.max(0, grant.until - now) : 0
  const leftPct = grant ? Math.min(100, (left / grant.span) * 100) : 0
  const done = [
    recs.length > 0,
    !!probe || log.some(l => l.event === 'exported' || l.event === 'ai_denied'),
    !!grant || log.some(l => l.event === 'granted' || l.event === 'ai_read'),
  ]
  const current = done.indexOf(false)
  const leftLabel = left > 3600e3 ? `${Math.ceil(left / 3600e3)} h` : `${Math.floor(left / 60e3)}:${String(Math.floor(left / 1e3) % 60).padStart(2, '0')}`
  const describe = (l: LogEvent) => {
    const f = t.events[l.event] as (n: number, u?: string) => string
    return f(l.count, l.until ? hm(l.until) : undefined)
  }

  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href="/home">
          <span className="brand-mark" aria-hidden />
          <span>{t.brand}</span>
        </a>
        <div className="bar-right">
          <LangSwitch lang={lang} onChange={setLang} />
          <span className="muted hide-sm">{name}</span>
          <button className="btn btn-line" onClick={() => logout()}>{t.signOut}</button>
        </div>
      </header>

      <section className="top">
        <div className="top-copy">
          <h1>{t.heroTitle}</h1>
          <p>{t.heroText}</p>
        </div>
        <div className="passport-bar" aria-label={t.cardTitle}>
          <div className="pb-who">
            <span className="pb-label">{t.cardTitle}</span>
            <strong>{name || '…'}</strong>
          </div>
          <dl className="pb-stats">
            <div><dt>{t.patientId}</dt><dd>{vuid ? vuid.slice(0, 8) : '…'}</dd></div>
            <div><dt>{t.entries}</dt><dd>{recs.length}</dd></div>
            <div><dt>{t.key}</dt><dd><Icon name="lock" size={14} /> {t.keyHolder}</dd></div>
          </dl>
          <div className="pb-actions">
            {recs.length === 0 && loaded && (
              <button className="btn btn-ghost" disabled={!!busy} onClick={loadSamples}>{busy === 'samples' ? t.sealing(SAMPLES[lang].length) : t.loadSamples}</button>
            )}
            <button className="btn btn-white" onClick={() => dialog.current?.showModal()}>{t.add}</button>
          </div>
        </div>
        <ol className="stepper">
          {t.steps.map((label, i) => (
            <li key={i} className={done[i] ? 'done' : i === current ? 'now' : ''}>
              <span className="step-no">{done[i] ? <Icon name="check" size={14} /> : i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </section>

      {err && <p className="alert" role="alert">{err} <button className="link" onClick={() => setErr('')}>{t.dismiss}</button></p>}

      <main className="grid">
        <section className="timeline-wrap" aria-labelledby="tl">
          <div className="section-head">
            <h2 id="tl"><span className="num">1</span>{t.record}</h2>
            <span className="muted">{selected.size > 0 ? t.selected(selected.size) : recs.length > 0 ? t.tickToShare : ''}</span>
          </div>

          {!loaded && <p className="muted pad">{t.unsealing}</p>}
          {loaded && recs.length === 0 && (
            <div className="empty">
              <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden>
                <rect x="20" y="10" width="54" height="74" rx="5" fill="var(--cover)" />
                <rect x="20" y="10" width="8" height="74" rx="3" fill="var(--cover-deep)" />
                <circle cx="51" cy="40" r="12" fill="none" stroke="#c9d8ef" strokeWidth="2" />
                <path d="M51 34v12M45 40h12" stroke="#c9d8ef" strokeWidth="2.5" strokeLinecap="round" />
                <rect x="58" y="58" width="26" height="22" rx="4" fill="var(--seal)" />
                <path d="M64 58v-5a7 7 0 0114 0v5" fill="none" stroke="var(--seal)" strokeWidth="3" />
              </svg>
              <p><strong>{t.emptyTitle}</strong></p>
              <p className="muted">{t.emptyText}</p>
            </div>
          )}
          {broken > 0 && <p className="muted pad">{t.broken(broken)}</p>}

          {byYear.map(([year, items]) => (
            <div className="year" key={year}>
              <div className="year-label">{year}</div>
              <ol className="entries">
                {items.map((r, i) => {
                  const e = r.entry!
                  const on = selected.has(r.id)
                  const shared = grant?.ids.includes(r.id)
                  return (
                    <li key={r.id} className={`entry k-${e.kind}${on ? ' on' : ''}${fresh.has(r.id) ? ' fresh' : ''}`} style={{ animationDelay: `${i * 40}ms` }}>
                      <label className="entry-hit">
                        <input type="checkbox" checked={on} onChange={() => toggle(r.id)} />
                        <span className="kind-icon"><Icon name={e.kind} /></span>
                        <span className="entry-body">
                          <span className="entry-meta"><span className="kind">{t.kinds[e.kind]}</span>{dmy(e.date)}{e.facility && ` · ${e.facility}`}</span>
                          <span className="entry-title">{e.title}</span>
                          {e.detail && <span className="entry-detail">{e.detail}</span>}
                        </span>
                        {shared && <span className="shared-mark" title={t.recipients[grant!.to].name}><Icon name="eye" size={16} /></span>}
                        {fresh.has(r.id) && <span className="fresh-stamp">{t.sealed}</span>}
                      </label>
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </section>

        <aside className="side">
          <section className={`panel${current === 1 ? ' panel-now' : ''}`} aria-labelledby="probe">
            <h2 id="probe"><span className="num">2</span>{t.probeTitle}</h2>
            <p className="muted small hint">{t.probeHint}</p>
            <div className="probe-actions">
              <button className="btn btn-line" disabled={!!busy || recs.length === 0} onClick={openAsAdmin}>{busy === 'admin' ? t.opening : t.openAdmin}</button>
              <button className="btn btn-line" disabled={!!busy || recs.length === 0} onClick={aiWithoutConsent}><Icon name="ai" size={16} />{busy === 'ai' ? t.reading : t.letAi}</button>
            </div>
            {probe?.kind === 'admin' && (
              <div className="vault">
                <p className="small muted">{t.exported(probe.rows.length)}</p>
                {probe.rows.slice(-3).reverse().map(r => (
                  <div className="sealed" key={r.id}>
                    <code>{r.ciphertext}</code>
                    <span className="stamp">{t.stamp}</span>
                  </div>
                ))}
              </div>
            )}
            {probe?.kind === 'ai' && (
              <div className="verdict" key={log.length}>
                <span className="verdict-lock"><Icon name="lock" size={22} /></span>
                <span>
                  <strong>{t.aiZero(probe.attempted)}</strong>
                  <span>{t.aiWhy}</span>
                </span>
              </div>
            )}
          </section>

          <section className={`panel${current === 2 ? ' panel-now' : ''}`} aria-labelledby="share">
            <h2 id="share"><span className="num">3</span>{t.shareTitle}</h2>
            {!grant ? (
              <>
                <p className="muted small hint">{t.shareHint}</p>
                <div className="seg" role="radiogroup">
                  {(['doctor', 'ai'] as Recipient[]).map(k => (
                    <button key={k} role="radio" aria-checked={to === k} className={to === k ? 'on' : ''} onClick={() => setTo(k)}>
                      <span className={`avatar av-${k}`}>{k === 'doctor' ? 'MA' : <Icon name="ai" size={18} />}</span>
                      <span className="seg-text"><strong>{t.recipients[k].name}</strong><span>{t.recipients[k].who}</span></span>
                    </button>
                  ))}
                </div>
                <label className="field">
                  <span>{t.howLong}</span>
                  <select value={duration} onChange={e => setDuration(Number(e.target.value))}>
                    {DURATIONS.map((ms, i) => <option key={ms} value={ms}>{t.durations[i]}</option>)}
                  </select>
                </label>
                <button className="btn btn-consent wide" disabled={!!busy || selected.size === 0} onClick={shareSelected}>
                  {selected.size === 0 ? t.selectToShare : busy === 'share' ? t.sharing : t.shareN(selected.size)}
                </button>
              </>
            ) : (
              <div className="grant">
                <div className="grant-head">
                  <span className={`avatar av-${grant.to}`}>{grant.to === 'doctor' ? 'MA' : <Icon name="ai" size={18} />}</span>
                  <div className="seg-text">
                    <strong>{t.recipients[grant.to].name}</strong>
                    <span className="muted">{t.recipients[grant.to].who}</span>
                  </div>
                  <span className="timer">{leftLabel}<small>{t.timeLeft}</small></span>
                </div>
                <div className="meter" aria-hidden><span style={{ width: `${leftPct}%` }} /></div>
                {grant.flags && (
                  <div className="flags">
                    {grant.flags.length ? grant.flags.map(f => <span key={f} className="flag">{t.flags[f as keyof typeof t.flags] ?? f}</span>) : <span className="muted">{t.noRisk}</span>}
                  </div>
                )}
                <p className="muted small">{t.theyCanRead}</p>
                <ul className="granted-list">
                  {grantedEntries.map(r => <li key={r.id} className={`k-${r.entry!.kind}`}><span className="dot" />{r.entry!.title}</li>)}
                </ul>
                <p className="muted small">{t.restSealed(hm(grant.until))}</p>
                <button className="btn btn-revoke wide" disabled={!!busy} onClick={revoke}>{t.revoke}</button>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="log">
            <h2 id="log">{t.logTitle}</h2>
            {log.length === 0 && <p className="muted small">{t.logEmpty}</p>}
            <ol className="log">
              {log.filter(l => l.event in OUTCOME).slice(0, 8).map(l => (
                <li key={l.id}>
                  <time>{hm(l.at)}</time>
                  <span><strong>{t.actors[l.actor]}</strong> {describe(l)}</span>
                  <span className={`badge b-${OUTCOME[l.event]}`}>{t.outcomes[OUTCOME[l.event]]}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </main>

      <dialog ref={dialog} className="modal" aria-labelledby="add-title">
        <form method="dialog" onSubmit={e => { e.preventDefault(); saveDraft() }}>
          <h2 id="add-title">{t.addTitle}</h2>
          <div className="examples">
            <span className="muted small">{t.example}</span>
            {SAMPLES[lang].map(s => <button type="button" key={s.title} className="pill" onClick={() => setDraft({ ...s } as Entry)}>{s.title}</button>)}
          </div>
          <div className="kinds" role="radiogroup">
            {KIND_ORDER.map(k => (
              <button type="button" key={k} role="radio" aria-checked={draft.kind === k} className={`k-${k}${draft.kind === k ? ' on' : ''}`} onClick={() => setDraft(d => ({ ...d, kind: k }))}><Icon name={k} size={15} />{t.kinds[k]}</button>
            ))}
          </div>
          <label className="field"><span>{t.title}</span><input required value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder={t.titlePh} /></label>
          <div className="two">
            <label className="field"><span>{t.date}</span><input type="date" required value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} /></label>
            <label className="field"><span>{t.facility}</span><input value={draft.facility} onChange={e => setDraft(d => ({ ...d, facility: e.target.value }))} placeholder={t.facilityPh} /></label>
          </div>
          <label className="field"><span>{t.details}</span><textarea rows={3} value={draft.detail} onChange={e => setDraft(d => ({ ...d, detail: e.target.value }))} placeholder={t.detailsPh} /></label>
          <p className="muted small">{t.sealNote}</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-line" onClick={() => dialog.current?.close()}>{t.cancel}</button>
            <button type="submit" className="btn btn-primary" disabled={!!busy || !draft.title.trim()}>{busy === 'save' ? t.saving : t.save}</button>
          </div>
        </form>
      </dialog>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
