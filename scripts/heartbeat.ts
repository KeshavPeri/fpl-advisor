// Heartbeat job — ticket #10.
//
// Proves the nightly scheduled-Action write path end to end with NO business
// logic: connect to Supabase with the secret key, insert one row into
// job_runs, exit. Later jobs (#11+) write their own rows into this same
// table; this script is deliberately the smallest possible thing that
// exercises the whole path (env -> Supabase client -> insert -> exit code)
// so a red run in GitHub Actions is diagnosable on sight.
//
// Reads exactly two environment variables — SUPABASE_URL and
// SUPABASE_SECRET_KEY. No fallback names, and no browser-bundle-prefixed
// variables of the kind src/lib/supabase.ts reads — this script runs in a
// GitHub Actions job, never in the browser.

import { createClient } from '@supabase/supabase-js'

const JOB_NAME = 'heartbeat'
const JOB_RUNS_MIGRATION = 'supabase/migrations/20260811130000_job_runs.sql'

interface SupabaseEnv {
  url: string
  secretKey: string
}

function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const missing: string[] = []
  if (!url) missing.push('SUPABASE_URL')
  if (!secretKey) missing.push('SUPABASE_SECRET_KEY')

  if (missing.length > 0) {
    console.error(
      'heartbeat: required environment variables are not set. ' +
        'Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set ' +
        `(missing: ${missing.join(', ')}). Making no network call.`
    )
    return null
  }

  // Both are present, so this narrowing is safe.
  return { url: url as string, secretKey: secretKey as string }
}

interface PostgrestLikeError {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

// PostgREST reports a relation it can't find in its schema cache as error
// code PGRST205 (its own code, not Postgres's) — that's what a hosted
// Supabase project returns when job_runs hasn't been migrated yet. Bare
// Postgres reached some other way would surface Postgres's own 42P01
// (undefined_table). Recognise either so the message is right regardless of
// how the missing table shows up.
function isMissingJobRunsTable(error: PostgrestLikeError): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return /job_runs/.test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

async function main(): Promise<void> {
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
  }

  const supabase = createClient(env.url, env.secretKey)

  const startedAt = new Date()
  const finishedAt = new Date()

  const { error } = await supabase.from('job_runs').insert({
    job_name: JOB_NAME,
    status: 'success',
    message: 'heartbeat: scheduled Action write path is alive',
    details: { ticket: 10, note: 'scaffold heartbeat — no business logic yet' },
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  })

  if (error) {
    if (isMissingJobRunsTable(error)) {
      console.error(
        `heartbeat: table "job_runs" does not exist in the target database. ` +
          `Apply the migration at ${JOB_RUNS_MIGRATION} before running this script.`
      )
    } else {
      console.error(`heartbeat: insert into job_runs failed: ${error.message}`)
    }
    process.exit(1)
  }

  console.log('heartbeat: wrote one row to job_runs')
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err)
  console.error(`heartbeat: unexpected failure: ${message}`)
  process.exit(1)
})
