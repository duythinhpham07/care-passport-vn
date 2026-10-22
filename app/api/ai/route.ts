import { NextRequest, NextResponse } from 'next/server'
import { readAll, log } from '../../lib/store'

// Mock "AI triage assistant" (rule-based, no external LLM — synthetic data only).
const FLAGS: [RegExp, string][] = [
  [/dị ứng|allerg/i, 'Allergy'],
  [/tiểu đường|đái tháo đường|diabet|hba1c/i, 'Diabetes'],
  [/huyết áp|hypertens|blood pressure/i, 'Blood pressure'],
  [/metformin|amlodipin|thuốc|\bmg\b/i, 'Active medication'],
  [/hiv|lao phổi|tuberculosis|viêm gan|hepatitis/i, 'Sensitive diagnosis'],
  [/tâm lý|trầm cảm|depress|anxiety|lo âu/i, 'Mental health'],
]

// mode "server": the AI tries to read the hospital DB on its own authority.
// mode "consent": the patient decrypted chosen entries in their browser and handed them over.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  if (body.mode === 'server') {
    const all = await readAll()
    await log('AI triage assistant', `Tried to read ${all.length} records without consent`, 'denied')
    return NextResponse.json({ mode: 'server', attempted: all.length, readable: 0 })
  }
  const texts: string[] = Array.isArray(body.texts) ? body.texts.map(String) : []
  const flags = new Set<string>()
  for (const t of texts) for (const [re, name] of FLAGS) if (re.test(t)) flags.add(name)
  await log('AI triage assistant', `Read ${texts.length} ${texts.length === 1 ? 'entry' : 'entries'} you shared`, 'granted')
  return NextResponse.json({ mode: 'consent', readable: texts.length, flags: [...flags] })
}
