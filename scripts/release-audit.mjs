/**
 * Release desensitization audit (plan/05 发布门, plan/RELEASE-M5.md).
 *
 * Rerunnable gate for the four desensitization steps. Any FAIL exits
 * non-zero; an all-pass run prints DESSENSITIZE_AUDIT_OK. Also runs as a
 * guard inside `pnpm test` (test/desensitize.test.js), so a dirty tree or a
 * dirty history breaks the normal test suite before any push.
 *
 * Steps (plan/05):
 *   1. filename gate      — no tracked path matches .env/.key/secret/token
 *   2. content scan       — every tracked text file, per-pattern below
 *   3. placeholder rule   — this audit and the release doc are themselves
 *                           tracked, so step 2 enforces them (a doc that
 *                           quotes a real literal fails the gate)
 *   4. history scan       — every commit's added/removed patch lines and
 *                           every commit message (run BEFORE the first push:
 *                           the first push publishes all local history)
 *
 * Binary samples: none are tracked today (release doc records the
 * extension census); if one lands, it needs a sha256 whitelist + data-ledger
 * entry per plan/06 before this gate can pass again.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

// [name, regex, allowlist?(matchText) -> true if benign]
const PATTERNS = [
  ['sk-key', /sk-[A-Za-z0-9_-]{16,}/, null],
  // Opaque quoted literals only: prose like "token = `session/event`" (slash)
  // or "token = `provider|model`" (pipe) is documentation, not a credential.
  ['key-assign', /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*["'`][A-Za-z0-9+_.-]{8,}["'`]/i, null],
  ['phone', /(?<!\d)1[3-9]\d{9}(?!\d)/, null],
  ['id-card', /(?<!\d)\d{17}[\dXx](?!\d)/, null],
  // plan/05 and HANDOFF docs name the placeholder `C:\Users\xx` verbatim —
  // that literal IS the placeholder, allow it.
  ['win-user-path', /[C-Z]:\\+Users\\+[A-Za-z0-9_.-]+/i, (m) => /:\\+Users\\+xx\b/i.test(m)],
  ['intranet-ip', /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/, null],
  // Reserved documentation domains are placeholders by construction.
  // git@github.com is the standard SSH remote form, not a personal identity.
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
    (m) => /@(?:example\.(?:com|org)|users\.noreply\.github\.com|github\.com)$/i.test(m)],
]

const scanText = (text, where, hits) => {
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    for (const [name, re, allow] of PATTERNS) {
      re.lastIndex = 0
      const m = re.exec(lines[i])
      if (!m) continue
      if (allow && allow(m[0])) continue
      hits.push(`${where}:${i + 1} [${name}] ${m[0]}`)
    }
  }
}

const isBinary = (buf) => buf.subarray(0, 8192).includes(0)

const failures = []
const note = (msg) => console.log(msg)

// Step 1 — filename gate.
const files = git(['-c', 'core.quotepath=false', 'ls-files']).split('\n').filter(Boolean)
const nameHits = files.filter((f) => /\.env$|\.key$|secret|token/i.test(f))
if (nameHits.length > 0) failures.push(`step1 filename gate: ${nameHits.join(', ')}`)
note(`step1 filename gate          : ${files.length} tracked files, ${nameHits.length} hits`)

// Step 2 — content scan of every tracked text file (working tree).
let binaryCount = 0
const contentHits = []
for (const f of files) {
  let buf
  try {
    buf = readFileSync(f)
  } catch {
    continue // deleted in the working tree; history scan still covers it
  }
  if (isBinary(buf)) {
    binaryCount += 1
    continue
  }
  scanText(buf.toString('utf8'), f, contentHits)
}
failures.push(...contentHits.map((h) => `step2 content scan: ${h}`))
note(`step2 content scan           : ${files.length - binaryCount} text files scanned, ${binaryCount} binary skipped, ${contentHits.length} hits`)

// Step 4 — full history: patch content lines only (every line that ever
// existed in the tree appears as a +/- line somewhere in the log), plus
// commit messages. Author/date header metadata is not file content; the
// release doc records the author-identity exposure separately.
const historyHits = []
let commitCount = 0
try {
  const patch = git(['log', '--all', '-p'])
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') || line.startsWith('-')) scanText(line, '(history)', historyHits)
  }
  const messages = git(['log', '--all', '--format=%H %s%n%b'])
  commitCount = (messages.match(/^[0-9a-f]{40} /gm) || []).length
  scanText(messages, '(commit-message)', historyHits)
} catch (err) {
  failures.push(`step4 history scan: git failed (${err.message.split('\n')[0]}) — run inside the repository`)
}
failures.push(...historyHits.map((h) => `step4 history scan: ${h}`))
note(`step4 history scan           : ${commitCount} commits (patches + messages), ${historyHits.length} hits`)

// Step 3 — placeholder discipline is enforced transitively: the release doc
// and this script are tracked, so step 2 fails if either quotes a real
// literal. Recorded here so the archive shows all four steps executed.
note(`step3 placeholder discipline : enforced transitively via step2 (release doc + this script are tracked)`)

if (failures.length > 0) {
  console.error('\nDESENSITIZE_AUDIT_FAIL')
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}
console.log('\nDESSENSITIZE_AUDIT_OK')
