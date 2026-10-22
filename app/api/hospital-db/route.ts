import { NextResponse } from 'next/server'
import { readAll } from '../../lib/store'

// Deliberately UNPROTECTED: this simulates the worst case — a hospital admin, an
// insider or a breached server dumping the whole database. All they get is ciphertext.
export async function GET() {
  return NextResponse.json(await readAll())
}
