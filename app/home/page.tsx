'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import { useState, useCallback, useEffect } from 'react'

// Records are encrypted under the patient's own Tide identity. The tag matches the
// _tide_message.selfencrypt/.selfdecrypt roles provisioned in init/realm.json.
const TAG = 'message'

type Rec = { id: string; createdAt: string; ciphertext: string; plain?: string }
type Sealed = { id: string; owner: string; createdAt: string; ciphertext: string }

const PRESETS = [
  { label: 'Dị ứng', text: 'Dị ứng penicillin: phát ban toàn thân năm 2019. Không dùng nhóm beta-lactam.' },
  { label: 'Tiểu đường', text: 'Tiểu đường type 2, đang dùng Metformin 500mg, 2 lần/ngày. HbA1c 7.2%.' },
  { label: 'Tâm lý', text: 'Tư vấn tâm lý: rối loạn lo âu nhẹ, 4 buổi tại BV Bạch Mai.' },
]

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function CarePassport() {
  const { logout, getValueFromIdToken, token, doEncrypt, doDecrypt } = useTideCloak()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [recs, setRecs] = useState<Rec[]>([])
  const [shared, setShared] = useState<Set<string>>(new Set())
  const [dump, setDump] = useState<Sealed[] | null>(null)
  const [ai, setAi] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    const res = await fetch('/api/records', { headers: auth })
    if (!res.ok) throw new Error(`Couldn't load your records (HTTP ${res.status}). Sign in again.`)
    const list: Rec[] = await res.json()
    // Decrypt in the browser: only this patient's Tide key can do it.
    const plains = list.length ? await doDecrypt(list.map(r => ({ encrypted: r.ciphertext, tags: [TAG] }))) : []
    setRecs(list.map((r, i) => ({ ...r, plain: String(plains[i]) })).reverse())
  }, [token, doDecrypt])

  useEffect(() => {
    if (token) {
      setName(getValueFromIdToken('preferred_username'))
      load().catch(e => setErr(String(e?.message || e)))
    }
  }, [token])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setErr('')
    try { await fn() } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy('') }
  }

  const save = () => run('save', async () => {
    const [ct] = await doEncrypt([{ data: text, tags: [TAG] }])
    const res = await fetch('/api/records', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ ciphertext: ct }) })
    if (!res.ok) throw new Error(`The hospital server refused the entry (HTTP ${res.status}).`)
    setText('')
    await load()
  })

  const viewAsAdmin = () => run('admin', async () => {
    setDump(await (await fetch('/api/hospital-db')).json())
  })

  const aiOnItsOwn = () => run('ai', async () => {
    const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'server' }) })
    setAi(await res.json())
  })

  const aiWithConsent = () => run('ai', async () => {
    const texts = recs.filter(r => shared.has(r.id)).map(r => r.plain)
    const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'consent', texts }) })
    setAi(await res.json())
  })

  const toggle = (id: string) => setShared(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <span>Care Passport VN<small>Sổ khám bệnh điện tử</small></span>
        </div>
        <div className="who">
          <span>Signed in as <b>{name}</b></span>
          <button className="btn btn-quiet" onClick={() => logout()}>Sign out</button>
        </div>
      </header>

      {err && <p className="error" role="alert">{err}</p>}

      <main className="layout">
        <section className="booklet" aria-labelledby="booklet-title">
          <h1 id="booklet-title">Your health record</h1>
          <p className="lede">
            Each entry is sealed with your Tide key before it leaves this device. The hospital stores it, but only you can open it.
          </p>
          <div className="keyline"><span className="keydot" aria-hidden />Key holder: you. No copy exists on the hospital server.</div>

          <div className="entry">
            <label htmlFor="note" className="sr-only" style={{ position: 'absolute', left: -9999 }}>New entry</label>
            <textarea id="note" value={text} onChange={e => setText(e.target.value)} placeholder="Ghi chú khám bệnh, kết quả xét nghiệm, đơn thuốc…" />
            <div className="entry-row">
              <div className="presets" aria-label="Example entries">
                {PRESETS.map(p => <button key={p.label} className="preset" onClick={() => setText(p.text)}>{p.label}</button>)}
              </div>
              <button className="btn btn-primary" disabled={!text || !!busy} onClick={save}>
                {busy === 'save' ? 'Sealing…' : 'Seal and save'}
              </button>
            </div>
          </div>

          <ol className="pages">
            {recs.length === 0 && <li className="empty">No entries yet. Add your first one above, or pick an example.</li>}
            {recs.map(r => (
              <li key={r.id} className={`page${shared.has(r.id) ? ' is-shared' : ''}`}>
                <time dateTime={r.createdAt}>{fmt(r.createdAt)}</time>
                <p>{r.plain}</p>
                <label className="share">
                  <input type="checkbox" checked={shared.has(r.id)} onChange={() => toggle(r.id)} />
                  Share with assistant
                </label>
              </li>
            ))}
          </ol>
        </section>

        <aside className="requests" aria-labelledby="who-title">
          <h2 id="who-title">Who else can read it?</h2>
          <p>Try it from their side.</p>

          <div className="party">
            <div className="party-head">
              <span className="avatar" aria-hidden>QT</span>
              <div>
                <h3>Hospital administrator</h3>
                <p>Full access to the database and the server.</p>
              </div>
            </div>
            <button className="btn btn-quiet" disabled={!!busy} onClick={viewAsAdmin}>
              {busy === 'admin' ? 'Opening…' : 'Open the database as admin'}
            </button>
            {dump && (
              <div className="vault">
                {dump.length === 0 && <p className="empty">The database is empty.</p>}
                {dump.slice(-4).reverse().map(r => (
                  <div className="sealed" key={r.id}>
                    <div className="owner">Patient {r.owner.slice(0, 8)}, {fmt(r.createdAt)}</div>
                    <code>{r.ciphertext}</code>
                    <span className="stamp">Sealed</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="party">
            <div className="party-head">
              <span className="avatar ai" aria-hidden>AI</span>
              <div>
                <h3>AI triage assistant</h3>
                <p>Helps doctors spot allergies and risks before treatment.</p>
              </div>
            </div>
            <div className="actions">
              <button className="btn btn-quiet" disabled={!!busy} onClick={aiOnItsOwn}>Let it read the database</button>
              <button className="btn btn-consent" disabled={!!busy || shared.size === 0} onClick={aiWithConsent}>
                Share {shared.size || ''} selected {shared.size === 1 ? 'entry' : 'entries'}
              </button>
            </div>

            {ai?.mode === 'server' && (
              <div className="verdict denied" role="status">
                <strong>Read {ai.readable} of {ai.attempted} records</strong>
                The assistant has no key. Without your consent, every record is sealed text.
              </div>
            )}
            {ai?.mode === 'consent' && (
              <div className="verdict granted" role="status">
                <strong>Read {ai.readable} {ai.readable === 1 ? 'record' : 'records'} you shared</strong>
                {ai.flags.length > 0 && <div className="flags">{ai.flags.map((f: string) => <span className="flag" key={f}>{f}</span>)}</div>}
                <ul>{ai.summary.map((s: string, i: number) => <li key={i}>{s.replace(/^• /, '')}</li>)}</ul>
              </div>
            )}
          </div>
        </aside>
      </main>
    </>
  )
}
