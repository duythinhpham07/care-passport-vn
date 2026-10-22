// Tiny JSON-file "hospital database". It only ever stores CIPHERTEXT produced in the
// patient's browser by TideCloak doEncrypt — the server has no key to read it.
import { promises as fs } from 'fs'
import path from 'path'

export type StoredRecord = {
  id: string
  owner: string        // patient's Tide vuid
  createdAt: string
  ciphertext: string
}

// Language-neutral log entries; the browser renders them in the patient's language.
export type Actor = 'you' | 'admin' | 'ai' | 'doctor'
export type EventKind = 'added' | 'exported' | 'ai_denied' | 'ai_read' | 'granted' | 'revoked'
export type AccessEvent = { id: string; at: string; actor: Actor; event: EventKind; count: number; until?: string }

const DIR = path.join(process.cwd(), 'data')
const DB_FILE = path.join(DIR, 'hospital-db.json')
const LOG_FILE = path.join(DIR, 'access-log.json')

async function readJson<T>(file: string): Promise<T[]> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'))
  } catch {
    return []
  }
}

async function writeJson(file: string, data: unknown) {
  await fs.mkdir(DIR, { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2))
}

export const readAll = () => readJson<StoredRecord>(DB_FILE)

export async function append(rec: StoredRecord) {
  const all = await readAll()
  all.push(rec)
  await writeJson(DB_FILE, all)
}

export const readLog = () => readJson<AccessEvent>(LOG_FILE)

export async function log(actor: Actor, event: EventKind, count = 0, until?: string) {
  const all = await readLog()
  all.push({ id: crypto.randomUUID(), at: new Date().toISOString(), actor, event, count, until })
  await writeJson(LOG_FILE, all.slice(-200))
}
