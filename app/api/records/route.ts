import { NextRequest, NextResponse } from 'next/server'
import { readAll, append, log } from '../../lib/store'
import { patientFrom } from '../../lib/auth'

// GET: the patient's own records (still ciphertext — decrypted only in their browser)
export async function GET(request: NextRequest) {
  const vuid = await patientFrom(request)
  if (!vuid) return NextResponse.json({ error: 'session' }, { status: 401 })
  const mine = (await readAll()).filter(r => r.owner === vuid)
  return NextResponse.json(mine)
}

// POST: store a ciphertext. The server never receives plaintext.
export async function POST(request: NextRequest) {
  const vuid = await patientFrom(request)
  if (!vuid) return NextResponse.json({ error: 'session' }, { status: 401 })
  const { ciphertext } = await request.json().catch(() => ({}))
  if (typeof ciphertext !== 'string' || !ciphertext) {
    return NextResponse.json({ error: 'not_encrypted' }, { status: 400 })
  }
  const rec = { id: crypto.randomUUID(), owner: vuid, createdAt: new Date().toISOString(), ciphertext }
  await append(rec)
  await log('you', 'added', 1)
  return NextResponse.json(rec, { status: 201 })
}
