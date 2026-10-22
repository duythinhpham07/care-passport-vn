import { NextRequest, NextResponse } from 'next/server'
import { readAll, append, log } from '../../lib/store'
import { patientFrom } from '../../lib/auth'

// GET: the patient's own records (still ciphertext — decrypted only in their browser)
export async function GET(request: NextRequest) {
  const vuid = await patientFrom(request)
  if (!vuid) return NextResponse.json({ error: 'Your session expired. Sign in again.' }, { status: 401 })
  const mine = (await readAll()).filter(r => r.owner === vuid)
  return NextResponse.json(mine)
}

// POST: store a ciphertext. The server never receives plaintext.
export async function POST(request: NextRequest) {
  const vuid = await patientFrom(request)
  if (!vuid) return NextResponse.json({ error: 'Your session expired. Sign in again.' }, { status: 401 })
  const { ciphertext } = await request.json().catch(() => ({}))
  if (typeof ciphertext !== 'string' || !ciphertext) {
    return NextResponse.json({ error: 'Nothing to store: the entry was not encrypted.' }, { status: 400 })
  }
  const rec = { id: crypto.randomUUID(), owner: vuid, createdAt: new Date().toISOString(), ciphertext }
  await append(rec)
  await log('You', 'Added a sealed entry to your record', 'saved')
  return NextResponse.json(rec, { status: 201 })
}
