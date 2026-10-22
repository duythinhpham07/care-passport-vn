import type { NextRequest } from 'next/server'
import { verifyTideCloakToken } from '@tidecloak/nextjs/server'
import tcConfig from '../../tidecloak.json'

// Returns the patient's Tide vuid from a verified Bearer token, or null.
export async function patientFrom(request: NextRequest): Promise<string | null> {
  const auth = request.headers.get('authorization')
  if (!auth?.startsWith('Bearer ')) return null
  try {
    const user = await verifyTideCloakToken(tcConfig, auth.split(' ')[1], ['offline_access']) as Record<string, any>
    return user?.vuid ?? null
  } catch {
    return null
  }
}
