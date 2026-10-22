'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import { useState, useCallback, useEffect, type CSSProperties } from 'react'

// Records are encrypted under the patient's own Tide identity. The tag matches the
// _tide_message.selfencrypt/.selfdecrypt roles provisioned in init/realm.json.
const TAG = 'message'

type Rec = { id: string; createdAt: string; ciphertext: string; plain?: string }

const SAMPLES = [
  'Dị ứng penicillin — phát ban toàn thân (2019). Không dùng nhóm beta-lactam.',
  'Tiểu đường type 2, đang dùng Metformin 500mg x 2 lần/ngày. HbA1c 7.2%.',
  'Khám tâm lý: rối loạn lo âu nhẹ, tư vấn 4 buổi tại BV Bạch Mai.',
]

export default function CarePassport() {
  const { logout, getValueFromIdToken, token, doEncrypt, doDecrypt } = useTideCloak()
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [recs, setRecs] = useState<Rec[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dbDump, setDbDump] = useState<any[] | null>(null)
  const [ai, setAi] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  const auth = { Authorization: `Bearer ${token}` }

  const load = useCallback(async () => {
    const res = await fetch('/api/records', { headers: auth })
    if (!res.ok) return
    const list: Rec[] = await res.json()
    // Decrypt in the browser — only this patient's Tide key can do it.
    const plains = list.length ? await doDecrypt(list.map(r => ({ encrypted: r.ciphertext, tags: [TAG] }))) : []
    setRecs(list.map((r, i) => ({ ...r, plain: String(plains[i]) })))
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
    await fetch('/api/records', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ ciphertext: ct }) })
    setText('')
    await load()
  })

  const showDb = () => run('db', async () => {
    setDbDump(await (await fetch('/api/hospital-db')).json())
  })

  const aiServer = () => run('ai', async () => {
    const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'server' }) })
    setAi(await res.json())
  })

  const aiConsent = () => run('ai', async () => {
    const texts = recs.filter(r => selected.has(r.id)).map(r => r.plain)
    const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'consent', texts }) })
    setAi(await res.json())
  })

  const toggle = (id: string) => setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  return (
    <div style={page}>
      <header style={header}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.6rem' }}>🩺 Care Passport VN</h1>
          <p style={{ margin: '.25rem 0 0', color: '#456' }}>Your health record. Your key. No admin, hospital or AI can open it without you.</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div>Patient: <b>{name}</b></div>
          <button style={btnGhost} onClick={() => logout()}>Log out</button>
        </div>
      </header>

      {err && <p style={{ color: '#c00' }}>⚠️ {err}</p>}

      <div style={grid}>
        <section style={card}>
          <h2 style={h2}>① Patient — my records</h2>
          <textarea style={area} value={text} onChange={e => setText(e.target.value)} placeholder="Nhập ghi chú y tế (tiếng Việt)…" />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
            {SAMPLES.map((s, i) => <button key={i} style={chip} onClick={() => setText(s)}>Mẫu {i + 1}</button>)}
          </div>
          <button style={btn} disabled={!text || !!busy} onClick={save}>{busy === 'save' ? 'Encrypting…' : '🔒 Encrypt & save'}</button>
          <ul style={{ paddingLeft: 0, listStyle: 'none' }}>
            {recs.map(r => (
              <li key={r.id} style={item}>
                <label style={{ display: 'flex', gap: 8 }}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  <span>{r.plain}</span>
                </label>
                <small style={{ color: '#789' }}>{new Date(r.createdAt).toLocaleString()} · decrypted in your browser</small>
              </li>
            ))}
          </ul>
        </section>

        <section style={card}>
          <h2 style={h2}>② Hospital admin — raw database</h2>
          <p style={muted}>What an admin, insider or attacker with full DB access gets.</p>
          <button style={btnDark} disabled={!!busy} onClick={showDb}>Dump hospital database</button>
          {dbDump && (
            <pre style={pre}>{JSON.stringify(dbDump.map(r => ({ owner: r.owner.slice(0, 10) + '…', ciphertext: r.ciphertext.slice(0, 80) + '…' })), null, 2)}</pre>
          )}
        </section>

        <section style={card}>
          <h2 style={h2}>③ AI triage assistant</h2>
          <p style={muted}>The AI cannot help itself to your data. It only reads what you hand it.</p>
          <button style={btnDark} disabled={!!busy} onClick={aiServer}>🤖 AI reads the DB on its own</button>
          <button style={{ ...btn, marginLeft: 8 }} disabled={!!busy || selected.size === 0} onClick={aiConsent}>
            ✅ Share {selected.size} selected record(s)
          </button>
          {ai && (
            <div style={{ ...pre, whiteSpace: 'normal' }}>
              {ai.mode === 'server' ? (
                <>
                  <b>❌ Readable: {ai.readable} / {ai.attempted}</b>
                  <p>{ai.note}</p>
                  {ai.sample?.map((s: string, i: number) => <code key={i} style={{ display: 'block' }}>{s}</code>)}
                </>
              ) : (
                <>
                  <b>✅ Summary from {ai.readable} record(s) you consented to</b>
                  <p>Flags: {ai.flags.join(', ') || 'none'}</p>
                  {ai.summary.map((s: string, i: number) => <div key={i}>{s}</div>)}
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

const page: CSSProperties = { minHeight: '100vh', background: '#eef4f7', padding: '24px', fontFamily: 'system-ui, sans-serif', color: '#123' }
const header: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }
const grid: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }
const card: CSSProperties = { background: '#fff', borderRadius: 10, padding: 16, boxShadow: '0 2px 10px rgba(0,0,0,.08)' }
const h2: CSSProperties = { fontSize: '1.1rem', marginTop: 0 }
const muted: CSSProperties = { color: '#567', fontSize: '.9rem' }
const area: CSSProperties = { width: '100%', minHeight: 70, boxSizing: 'border-box', padding: 8, borderRadius: 6, border: '1px solid #bcd', fontFamily: 'inherit' }
const btn: CSSProperties = { padding: '8px 14px', borderRadius: 6, border: 'none', background: '#0a7d5a', color: '#fff', cursor: 'pointer' }
const btnDark: CSSProperties = { ...btn, background: '#334' }
const btnGhost: CSSProperties = { ...btn, background: 'transparent', color: '#0a7d5a', border: '1px solid #0a7d5a', marginTop: 4 }
const chip: CSSProperties = { padding: '3px 10px', borderRadius: 12, border: '1px solid #9bc', background: '#f4fafc', cursor: 'pointer' }
const item: CSSProperties = { borderTop: '1px solid #eee', padding: '8px 0' }
const pre: CSSProperties = { background: '#0f1720', color: '#cfe', padding: 10, borderRadius: 6, fontSize: 12, overflowX: 'auto', marginTop: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }
