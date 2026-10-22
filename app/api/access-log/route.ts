import { NextRequest, NextResponse } from 'next/server'
import { readLog, log } from '../../lib/store'
import { patientFrom } from '../../lib/auth'

export async function GET(request: NextRequest) {
  if (!(await patientFrom(request))) return NextResponse.json({ error: 'Your session expired. Sign in again.' }, { status: 401 })
  return NextResponse.json((await readLog()).reverse())
}

// The patient records grants/revocations they made (the plaintext never reaches here).
export async function POST(request: NextRequest) {
  if (!(await patientFrom(request))) return NextResponse.json({ error: 'Your session expired. Sign in again.' }, { status: 401 })
  const { actor, action, outcome } = await request.json().catch(() => ({}))
  if (!actor || !action || !['granted', 'revoked'].includes(outcome)) {
    return NextResponse.json({ error: 'Invalid log entry.' }, { status: 400 })
  }
  await log(String(actor), String(action), outcome)
  return NextResponse.json({ ok: true }, { status: 201 })
}
