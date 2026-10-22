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

const DB_FILE = path.join(process.cwd(), 'data', 'hospital-db.json')

export async function readAll(): Promise<StoredRecord[]> {
  try {
    return JSON.parse(await fs.readFile(DB_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export async function append(rec: StoredRecord) {
  const all = await readAll()
  all.push(rec)
  await fs.mkdir(path.dirname(DB_FILE), { recursive: true })
  await fs.writeFile(DB_FILE, JSON.stringify(all, null, 2))
}
