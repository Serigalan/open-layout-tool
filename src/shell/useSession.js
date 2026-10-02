import { useCallback, useEffect, useState } from 'react'
import { api, setUnauthorizedHandler } from '../api/client'
import { flushPendingWrites } from '../storage'

const ANON = { status: 'anon', user: null }

/**
 * Who is signed in (AP 10.6, R2.5): status 'loading' | 'anon' | 'user'. The
 * app opens nothing without a session (decision 88); a request the server
 * answers with 401 signs the app out.
 */
export default function useSession() {
  const [session, setSession] = useState({ status: 'loading', user: null })

  useEffect(() => {
    setUnauthorizedHandler(() => setSession(ANON))
    api.me()
      .then(({ user }) => setSession({ status: 'user', user }))
      .catch(() => setSession(ANON))
  }, [])

  const signedIn = useCallback((user) => setSession({ status: 'user', user }), [])

  const signOut = useCallback(async () => {
    await flushPendingWrites()
    try { await api.logout() } catch { /* the session is gone either way */ }
    setSession(ANON)
  }, [])

  return { ...session, signedIn, signOut }
}
