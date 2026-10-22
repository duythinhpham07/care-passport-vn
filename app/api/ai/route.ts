import { NextRequest, NextResponse } from 'next/server'
import { readAll, log } from '../../lib/store'

// Mock "AI triage assistant" (rule-based, no external LLM — synthetic data only).
// Works on Vietnamese and English text; returns language-neutral flag codes.
const FLAGS: [RegExp, string][] = [
  [/dị ứng|allerg/i, 'allergy'],
  [/tiểu đường|đái tháo đường|diabet|hba1c/i, 'diabetes'],
  [/huyết áp|hypertens|blood pressure/i, 'bp'],
  [/metformin|amlodipin|thuốc|\bmg\b/i, 'meds'],
  [/hiv|lao phổi|tuberculosis|viêm gan|hepatitis/i, 'sensitive'],
  [/tâm lý|trầm cảm|lo âu|depress|anxiety|counsel/i, 'mental'],
]

// mode "server": the AI tries to read the hospital DB on its own authority.
// mode "consent": the patient decrypted chosen entries in their browser and handed them over.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  if (body.mode === 'server') {
    const all = await readAll()
    await log('ai', 'ai_denied', all.length)
    return NextResponse.json({ mode: 'server', attempted: all.length, readable: 0 })
  }
  const texts: string[] = Array.isArray(body.texts) ? body.texts.map(String) : []
  const flags = new Set<string>()
  for (const t of texts) for (const [re, code] of FLAGS) if (re.test(t)) flags.add(code)
  await log('ai', 'ai_read', texts.length)
  return NextResponse.json({ mode: 'consent', readable: texts.length, flags: [...flags] })
}
