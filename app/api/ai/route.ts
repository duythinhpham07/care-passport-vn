import { NextRequest, NextResponse } from 'next/server'
import { readAll } from '../../lib/store'

// Mock "AI triage assistant" (rule-based, no external LLM — synthetic data only).
const FLAGS: [RegExp, string][] = [
  [/dị ứng|allerg/i, 'Allergy'],
  [/tiểu đường|đái tháo đường|diabet/i, 'Diabetes'],
  [/huyết áp|hypertens|blood pressure/i, 'Blood pressure'],
  [/thuốc|mg|medic/i, 'Medication'],
  [/hiv|lao|tuberculosis|viêm gan|hepatitis/i, 'Sensitive diagnosis'],
  [/tâm lý|trầm cảm|depress|anxiety|lo âu/i, 'Mental health'],
]

function summarise(texts: string[]) {
  const flags = new Set<string>()
  for (const t of texts) for (const [re, name] of FLAGS) if (re.test(t)) flags.add(name)
  return {
    readable: texts.length,
    flags: [...flags],
    summary: texts.map(t => '• ' + (t.length > 90 ? t.slice(0, 90) + '…' : t)),
  }
}

// mode "server": the AI tries to read the hospital DB on its own authority.
// mode "consent": the patient decrypted chosen records in their browser and handed them over.
export async function POST(request: NextRequest) {
  const body = await request.json()
  if (body.mode === 'server') {
    const all = await readAll()
    return NextResponse.json({
      mode: 'server',
      attempted: all.length,
      readable: 0,
      note: 'AI only sees ciphertext — no key on the server, no admin override.',
      sample: all.slice(0, 2).map(r => r.ciphertext.slice(0, 60) + '…'),
    })
  }
  const texts: string[] = Array.isArray(body.texts) ? body.texts.map(String) : []
  return NextResponse.json({ mode: 'consent', ...summarise(texts) })
}
