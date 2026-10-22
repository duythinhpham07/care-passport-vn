import { NextRequest, NextResponse } from 'next/server'
import { verifyTideCloakToken } from '@tidecloak/nextjs/server'
import tcConfig from '../../../tidecloak.json'
import { readAll, append } from '../../lib/store'

async function patientFrom(request: NextRequest): Promise<string | null> {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const user = await verifyTideCloakToken(tcConfig, auth.split(' ')[1], ['offline_access']) as Record<string, any>
    return user?.vuid ?? null
  } catch {
    return null
  }
}

// GET: the patient's own records (still ciphertext — decrypted only in their browser)
export async function GET(request: NextRequest) {
  const vuid = await patientFrom(request)
  if (!vuid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const mine = (await readAll()).filter(r => r.owner === vuid)
  return NextResponse.json(mine)
}

// POST: store a ciphertext. The server never receives plaintext.
export async function POST(request: NextRequest) {
  const vuid = await patientFrom(request)
  if (!vuid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { ciphertext } = await request.json()
  if (typeof ciphertext !== 'string' || !ciphertext) {
    return NextResponse.json({ error: 'ciphertext required' }, { status: 400 })
  }
  const rec = { id: crypto.randomUUID(), owner: vuid, createdAt: new Date().toISOString(), ciphertext }
  await append(rec)
  return NextResponse.json(rec, { status: 201 })
}
