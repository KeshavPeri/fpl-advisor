import { useEffect, useState } from 'react'
import { supabase, supabaseConfigured } from './lib/supabase'
import './App.css'

type ConnectionStatus = 'checking' | 'connected' | 'not-configured' | 'error'

function App() {
  const [status, setStatus] = useState<ConnectionStatus>('checking')

  useEffect(() => {
    if (!supabaseConfigured) {
      setStatus('not-configured')
      return
    }

    // Querying a table that doesn't exist still proves the URL + anon key are
    // valid and Supabase answered — a "relation does not exist" style error
    // means the connection itself worked. Any network/auth failure means it didn't.
    const checkConnection = async () => {
      try {
        const { error } = await supabase
          .from('__connectivity_check__')
          .select('*')
          .limit(1)

        if (!error || error.code === '42P01' || error.code === 'PGRST205') {
          setStatus('connected')
        } else {
          setStatus('error')
          console.error('Supabase connectivity check failed:', error)
        }
      } catch (err) {
        setStatus('error')
        console.error('Supabase connectivity check failed:', err)
      }
    }

    void checkConnection()
  }, [])

  return (
    <main className="scaffold">
      <h1>FPL Advisor</h1>
      <p className="tagline">Your Fantasy Premier League decisions, thought through.</p>
      <p>PWA scaffold — infrastructure setup (Phase 3). No app features yet.</p>
      <p className="supabase-status" data-status={status}>
        Supabase: {status === 'checking' && 'checking connection…'}
        {status === 'connected' && 'connected ✓'}
        {status === 'not-configured' && 'env vars not set'}
        {status === 'error' && 'connection error — check console'}
      </p>
    </main>
  )
}

export default App
