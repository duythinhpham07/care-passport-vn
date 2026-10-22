import { NextResponse } from 'next/server'
import { readAll, log } from '../../lib/store'

// Deliberately UNPROTECTED: this simulates the worst case — a hospital admin, an
// insider or a breached server dumping the whole database. All they get is ciphertext.
export async function GET() {
  const all = await readAll()
  await log('Hospital administrator', `Opened the database and exported ${all.length} records`, 'sealed')
  return NextResponse.json(all)
}
