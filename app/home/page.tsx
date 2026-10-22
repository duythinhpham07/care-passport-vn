'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'

// Entries are encrypted under the patient's own Tide identity. The tag matches the
// _tide_message.selfencrypt/.selfdecrypt roles provisioned in init/realm.json.
const TAG = 'message'

type Kind = 'allergy' | 'condition' | 'medication' | 'lab' | 'visit'
type Entry = { kind: Kind; title: string; date: string; facility: string; detail: string }
type Rec = { id: string; createdAt: string; ciphertext: string; entry?: Entry; broken?: boolean }
type Sealed = { id: string; owner: string; createdAt: string; ciphertext: string }
type LogEvent = { id: string; at: string; actor: string; action: string; outcome: 'sealed' | 'denied' | 'granted' | 'revoked' | 'saved' }
type Grant = { to: Recipient; ids: string[]; until: number; ai?: { flags: string[] } }
type Recipient = 'doctor' | 'ai'

const KINDS: Record<Kind, string> = {
  allergy: 'Allergy', condition: 'Condition', medication: 'Medication', lab: 'Lab result', visit: 'Visit',
}

const RECIPIENTS: Record<Recipient, { name: string; who: string }> = {
  doctor: { name: 'Emergency doctor', who: 'BS. Nguyễn Minh Anh, Cấp cứu BV Bạch Mai' },
  ai: { name: 'AI triage assistant', who: 'Flags allergies and risks before treatment' },
}

const DURATIONS = [{ label: '15 minutes', ms: 15 * 60e3 }, { label: '1 hour', ms: 60 * 60e3 }, { label: '24 hours', ms: 24 * 60 * 60e3 }]

const SAMPLES: Entry[] = [
  { kind: 'allergy', title: 'Dị ứng penicillin', date: '2019-03-14', facility: 'BV Bạch Mai', detail: 'Phát ban toàn thân sau tiêm amoxicillin. Không dùng nhóm beta-lactam.' },
  { kind: 'condition', title: 'Tiểu đường type 2', date: '2023-08-02', facility: 'BV Nội tiết Trung ương', detail: 'Chẩn đoán lần đầu, HbA1c 7.8%. Theo dõi mỗi 3 tháng.' },
  { kind: 'medication', title: 'Metformin 500mg', date: '2023-08-02', facility: 'BV Nội tiết Trung ương', detail: 'Uống 2 lần/ngày sau ăn sáng và tối.' },
  { kind: 'lab', title: 'Xét nghiệm HbA1c', date: '2025-11-20', facility: 'Phòng khám Medlatec', detail: 'HbA1c 7.2%, đường huyết lúc đói 6.9 mmol/L.' },
  { kind: 'visit', title: 'Tư vấn tâm lý', date: '2026-04-09', facility: 'BV Bạch Mai', detail: 'Rối loạn lo âu nhẹ. 4 buổi trị liệu, không dùng thuốc.' },
]

const blank = (): Entry => ({ kind: 'visit', title: '', date: new Date().toISOString().slice(0, 10), facility: '', detail: '' })
const dmy = (d: string) => new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
const hm = (d: string | number) => new Date(d).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
const asText = (e: Entry) => `${KINDS[e.kind]}: ${e.title}. ${e.detail} (${e.facility}, ${dmy(e.date)})`

function parse(plain: string): Entry {
  try {
    const e = JSON.parse(plain)
    if (e && e.kind in KINDS) return e
  } catch {}
  return { kind: 'visit', title: plain.slice(0, 60), date: new Date().toISOString(), facility: '', detail: plain }
}

export default function CarePassport() {
  const { logout, getValueFromIdToken, token, doEncrypt, doDecrypt, authenticated, isInitializing } = useTideCloak()
  const [name, setName] = useState('')
  const [vuid, setVuid] = useState('')
  const [recs, setRecs] = useState<Rec[]>([])
  const [loaded, setLoaded] = useState(false)
  const [log, setLog] = useState<LogEvent[]>([])
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')

  const [draft, setDraft] = useState<Entry>(blank)
  const dialog = useRef<HTMLDialogElement>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [to, setTo] = useState<Recipient>('doctor')
  const [duration, setDuration] = useState(DURATIONS[0].ms)
  const [grant, setGrant] = useState<Grant | null>(null)
  const [now, setNow] = useState(Date.now())

  const [probe, setProbe] = useState<{ kind: 'admin'; rows: Sealed[] } | { kind: 'ai'; attempted: number } | null>(null)

  const auth = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const say = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2600) }

  const refreshLog = useCallback(async () => {
    const res = await fetch('/api/access-log', { headers: auth })
    if (res.ok) setLog(await res.json())
  }, [auth])

  const load = useCallback(async () => {
    const res = await fetch('/api/records', { headers: auth })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Couldn't load your record (HTTP ${res.status}).`)
    const list: Rec[] = await res.json()
    // Decrypt in the browser, one by one so a single bad entry can't hide the rest.
    const out = await Promise.all(list.map(async r => {
      try {
        const [plain] = await doDecrypt([{ encrypted: r.ciphertext, tags: [TAG] }])
        return { ...r, entry: parse(String(plain)) }
      } catch {
        return { ...r, broken: true }
      }
    }))
    setRecs(out)
    setLoaded(true)
  }, [auth, doDecrypt])

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
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `The hospital server refused the entry (HTTP ${res.status}).`)
    }
    await Promise.all([load(), refreshLog()])
  }

  const saveDraft = () => run('save', async () => {
    await seal([{ ...draft, title: draft.title.trim(), facility: draft.facility.trim(), detail: draft.detail.trim() }])
    dialog.current?.close()
    setDraft(blank())
    say('Entry sealed and saved')
  })

  const loadSamples = () => run('samples', async () => {
    await seal(SAMPLES)
    say(`${SAMPLES.length} sample entries sealed and saved`)
  })

  const openAsAdmin = () => run('admin', async () => {
    const rows: Sealed[] = await (await fetch('/api/hospital-db')).json()
    setProbe({ kind: 'admin', rows })
    await refreshLog()
  })

  const aiWithoutConsent = () => run('ai', async () => {
    const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'server' }) })
    const data = await res.json()
    setProbe({ kind: 'ai', attempted: data.attempted })
    await refreshLog()
  })

  const shareSelected = () => run('share', async () => {
    const chosen = recs.filter(r => selected.has(r.id) && r.entry)
    const until = Date.now() + duration
    const label = `${chosen.length} ${chosen.length === 1 ? 'entry' : 'entries'}`
    let ai: Grant['ai']
    if (to === 'ai') {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'consent', texts: chosen.map(r => asText(r.entry!)) }) })
      ai = { flags: (await res.json()).flags }
    } else {
      await fetch('/api/access-log', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: RECIPIENTS.doctor.name, action: `Can read ${label} until ${hm(until)}`, outcome: 'granted' }) })
    }
    setGrant({ to, ids: chosen.map(r => r.id), until, ai })
    setNow(Date.now())
    await refreshLog()
    say(`Shared ${label} with ${RECIPIENTS[to].name.toLowerCase()}`)
  })

  const revoke = () => run('revoke', async () => {
    if (!grant) return
    await fetch('/api/access-log', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ actor: RECIPIENTS[grant.to].name, action: 'Access revoked by you', outcome: 'revoked' }) })
    setGrant(null)
    setSelected(new Set())
    await refreshLog()
    say('Access revoked')
  })

  const toggle = (id: string) => setSelected(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const byYear = useMemo(() => {
    const sorted = recs.filter(r => r.entry).sort((a, b) => b.entry!.date.localeCompare(a.entry!.date))
    const groups: [string, Rec[]][] = []
    for (const r of sorted) {
      const y = r.entry!.date.slice(0, 4)
      if (!groups.length || groups[groups.length - 1][0] !== y) groups.push([y, []])
      groups[groups.length - 1][1].push(r)
    }
    return groups
  }, [recs])
  const broken = recs.filter(r => r.broken).length
  const grantedEntries = grant ? recs.filter(r => grant.ids.includes(r.id) && r.entry) : []
  const left = grant ? Math.max(0, grant.until - now) : 0
  const leftLabel = left > 3600e3 ? `${Math.ceil(left / 3600e3)} h` : `${Math.floor(left / 60e3)}:${String(Math.floor(left / 1e3) % 60).padStart(2, '0')}`

  return (
    <div className="app">
      <header className="bar">
        <a className="brand" href="/home">
          <span className="brand-mark" aria-hidden />
          <span>Care Passport</span>
        </a>
        <div className="bar-right">
          <span className="muted">{name}</span>
          <button className="btn btn-line" onClick={() => logout()}>Sign out</button>
        </div>
      </header>

      <section className="hero">
        <div className="passport" aria-label="Patient card">
          <div className="passport-top">
            <span>Sổ khám bệnh điện tử</span>
            <span className="chip-key">Sealed</span>
          </div>
          <div className="passport-name">{name || 'Patient'}</div>
          <dl className="passport-grid">
            <div><dt>Patient ID</dt><dd>{vuid ? vuid.slice(0, 12) : '...'}</dd></div>
            <div><dt>Entries</dt><dd>{recs.length}</dd></div>
            <div><dt>Decryption key</dt><dd>Held by you, via Tide</dd></div>
            <div><dt>Key copies on server</dt><dd>0</dd></div>
          </dl>
        </div>
        <div className="hero-copy">
          <h1>Your medical history, sealed with a key only you hold.</h1>
          <p>The hospital keeps your record safe but cannot read it. Doctors and AI see only the entries you share, and only for as long as you allow.</p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={() => dialog.current?.showModal()}>Add entry</button>
            {recs.length === 0 && loaded && (
              <button className="btn btn-line" disabled={!!busy} onClick={loadSamples}>{busy === 'samples' ? 'Sealing 5 entries…' : 'Load sample history'}</button>
            )}
          </div>
        </div>
      </section>

      {err && <p className="alert" role="alert">{err} <button className="link" onClick={() => setErr('')}>Dismiss</button></p>}

      <main className="grid">
        <section className="timeline-wrap" aria-labelledby="tl">
          <div className="section-head">
            <h2 id="tl">Record</h2>
            <span className="muted">{selected.size > 0 ? `${selected.size} selected to share` : 'Tick entries to share them'}</span>
          </div>

          {!loaded && <p className="muted pad">Unsealing your record…</p>}
          {loaded && recs.length === 0 && (
            <div className="empty">
              <p><strong>Your record is empty.</strong></p>
              <p className="muted">Add your first entry, or load a sample history to try the sharing flow.</p>
            </div>
          )}
          {broken > 0 && <p className="muted pad">{broken} {broken === 1 ? 'entry' : 'entries'} couldn&apos;t be unsealed with your key.</p>}

          {byYear.map(([year, items]) => (
            <div className="year" key={year}>
              <div className="year-label">{year}</div>
              <ol className="entries">
                {items.map(r => {
                  const e = r.entry!
                  const on = selected.has(r.id)
                  return (
                    <li key={r.id} className={`entry k-${e.kind}${on ? ' on' : ''}`}>
                      <label className="entry-hit">
                        <input type="checkbox" checked={on} onChange={() => toggle(r.id)} aria-label={`Share ${e.title}`} />
                        <span className="entry-body">
                          <span className="entry-meta"><span className="kind">{KINDS[e.kind]}</span>{dmy(e.date)}{e.facility && `, ${e.facility}`}</span>
                          <span className="entry-title">{e.title}</span>
                          {e.detail && <span className="entry-detail">{e.detail}</span>}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ol>
            </div>
          ))}
        </section>

        <aside className="side">
          <section className="panel" aria-labelledby="share">
            <h2 id="share">Share access</h2>
            {!grant ? (
              <>
                <div className="seg" role="radiogroup" aria-label="Recipient">
                  {(Object.keys(RECIPIENTS) as Recipient[]).map(k => (
                    <button key={k} role="radio" aria-checked={to === k} className={to === k ? 'on' : ''} onClick={() => setTo(k)}>
                      <strong>{RECIPIENTS[k].name}</strong><span>{RECIPIENTS[k].who}</span>
                    </button>
                  ))}
                </div>
                <label className="field">
                  <span>For how long</span>
                  <select value={duration} onChange={e => setDuration(Number(e.target.value))}>
                    {DURATIONS.map(d => <option key={d.ms} value={d.ms}>{d.label}</option>)}
                  </select>
                </label>
                <button className="btn btn-consent wide" disabled={!!busy || selected.size === 0} onClick={shareSelected}>
                  {selected.size === 0 ? 'Select entries to share' : busy === 'share' ? 'Sharing…' : `Share ${selected.size} ${selected.size === 1 ? 'entry' : 'entries'}`}
                </button>
              </>
            ) : (
              <div className="grant">
                <div className="grant-head">
                  <div>
                    <strong>{RECIPIENTS[grant.to].name}</strong>
                    <span className="muted">{RECIPIENTS[grant.to].who}</span>
                  </div>
                  <span className="timer" aria-label="Time left">{leftLabel}</span>
                </div>
                {grant.ai && (
                  <div className="flags">
                    {grant.ai.flags.length ? grant.ai.flags.map(f => <span key={f} className="flag">{f}</span>) : <span className="muted">No risks flagged</span>}
                  </div>
                )}
                <p className="muted small">They can read:</p>
                <ul className="granted-list">
                  {grantedEntries.map(r => <li key={r.id}><span className={`dot k-${r.entry!.kind}`} />{r.entry!.title}</li>)}
                </ul>
                <p className="muted small">Everything else stays sealed. Access ends at {hm(grant.until)}.</p>
                <button className="btn btn-line wide" disabled={!!busy} onClick={revoke}>Revoke now</button>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="probe">
            <h2 id="probe">Try to read it without you</h2>
            <div className="probe-actions">
              <button className="btn btn-line" disabled={!!busy} onClick={openAsAdmin}>{busy === 'admin' ? 'Opening…' : 'Open database as admin'}</button>
              <button className="btn btn-line" disabled={!!busy} onClick={aiWithoutConsent}>{busy === 'ai' ? 'Reading…' : 'Let AI read the database'}</button>
            </div>
            {probe?.kind === 'admin' && (
              <div className="vault">
                <p className="small muted">Hospital administrator exported {probe.rows.length} records:</p>
                {probe.rows.slice(-3).reverse().map(r => (
                  <div className="sealed" key={r.id}>
                    <code>{r.ciphertext}</code>
                    <span className="stamp">Sealed</span>
                  </div>
                ))}
              </div>
            )}
            {probe?.kind === 'ai' && (
              <div className="verdict">
                <strong>0 of {probe.attempted} records readable</strong>
                <span>The assistant holds no key, and no admin can hand it one.</span>
              </div>
            )}
          </section>

          <section className="panel" aria-labelledby="log">
            <h2 id="log">Access log</h2>
            {log.length === 0 && <p className="muted small">No one has tried to access your record yet.</p>}
            <ol className="log">
              {log.slice(0, 8).map(l => (
                <li key={l.id}>
                  <time>{hm(l.at)}</time>
                  <span><strong>{l.actor}</strong> {l.action.charAt(0).toLowerCase() + l.action.slice(1)}</span>
                  <span className={`badge b-${l.outcome}`}>{l.outcome}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </main>

      <dialog ref={dialog} className="modal" aria-labelledby="add-title">
        <form method="dialog" onSubmit={e => { e.preventDefault(); saveDraft() }}>
          <h2 id="add-title">Add entry</h2>
          <div className="examples">
            <span className="muted small">Fill with an example:</span>
            {SAMPLES.map(s => <button type="button" key={s.title} className="pill" onClick={() => setDraft(s)}>{s.title}</button>)}
          </div>
          <div className="kinds" role="radiogroup" aria-label="Type">
            {(Object.keys(KINDS) as Kind[]).map(k => (
              <button type="button" key={k} role="radio" aria-checked={draft.kind === k} className={`k-${k}${draft.kind === k ? ' on' : ''}`} onClick={() => setDraft(d => ({ ...d, kind: k }))}>{KINDS[k]}</button>
            ))}
          </div>
          <label className="field"><span>Title</span><input required value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} placeholder="Dị ứng penicillin" /></label>
          <div className="two">
            <label className="field"><span>Date</span><input type="date" required value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} /></label>
            <label className="field"><span>Facility</span><input value={draft.facility} onChange={e => setDraft(d => ({ ...d, facility: e.target.value }))} placeholder="BV Bạch Mai" /></label>
          </div>
          <label className="field"><span>Details</span><textarea rows={3} value={draft.detail} onChange={e => setDraft(d => ({ ...d, detail: e.target.value }))} placeholder="Triệu chứng, chẩn đoán, chỉ định…" /></label>
          <p className="muted small">Sealed in this browser with your Tide key before it is sent.</p>
          <div className="modal-actions">
            <button type="button" className="btn btn-line" onClick={() => dialog.current?.close()}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!!busy || !draft.title.trim()}>{busy === 'save' ? 'Sealing…' : 'Seal and save'}</button>
          </div>
        </form>
      </dialog>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
