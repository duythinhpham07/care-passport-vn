import { NextRequest, NextResponse } from 'next/server'
import { readLog, log } from '../../lib/store'
import { patientFrom } from '../../lib/auth'

export async function GET(request: NextRequest) {
  if (!(await patientFrom(request))) return NextResponse.json({ error: 'session' }, { status: 401 })
  return NextResponse.json((await readLog()).reverse())
}

// The patient records grants/revocations they made (the plaintext never reaches here).
export async function POST(request: NextRequest) {
  if (!(await patientFrom(request))) return NextResponse.json({ error: 'session' }, { status: 401 })
  const { actor, event, count, until } = await request.json().catch(() => ({}))
  if (!['doctor', 'ai'].includes(actor) || !['granted', 'revoked'].includes(event)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  await log(actor, event, Number(count) || 0, typeof until === 'string' ? until : undefined)
  return NextResponse.json({ ok: true }, { status: 201 })
}
