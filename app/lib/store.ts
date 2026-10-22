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

export type AccessEvent = {
  id: string
  at: string
  actor: string        // who tried: "Hospital administrator", "AI triage assistant", ...
  action: string       // what they tried, in plain words
  outcome: 'sealed' | 'denied' | 'granted' | 'revoked' | 'saved'
}

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

export async function log(actor: string, action: string, outcome: AccessEvent['outcome']) {
  const all = await readLog()
  all.push({ id: crypto.randomUUID(), at: new Date().toISOString(), actor, action, outcome })
  await writeJson(LOG_FILE, all.slice(-200))
}
