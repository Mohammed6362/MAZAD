$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$appPath = Join-Path $root 'backend/src/app.js'
$middlewareDir = Join-Path $root 'backend/src/middleware'
$middlewarePath = Join-Path $middlewareDir 'supabaseVerify.js'
if (!(Test-Path (Join-Path $root '.git'))) { throw 'Run this from the MAZAD-GitHub repository root.' }
if (!(Test-Path $appPath)) { throw 'Missing backend/src/app.js; run from the MAZAD repository root.' }
if (!(Test-Path (Join-Path $root 'backend/package.json'))) { throw 'Missing backend/package.json.' }
$app = [System.IO.File]::ReadAllText($appPath)
$marker = "app.get('/api/health'"
if (!$app.Contains($marker)) { throw 'Could not locate /api/health anchor; no files modified.' }
$integration = "require('./middleware/supabaseVerify')(app);"
if ($app.Contains($integration)) {
  Write-Host 'Supabase verification route already installed.'
  exit 0
}
$middleware = @'
/**
 * Optional Supabase Auth verification endpoint.
 * This does not create a Mazad session or grant Mazad permissions.
 */
const { createClient } = require('@supabase/supabase-js');
let client;
function getClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return client;
}
module.exports = function registerSupabaseVerify(app) {
  app.get('/api/supabase/verify', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const bearer = /^Bearer\s+([^\s]+)$/i.exec(req.get('Authorization') || '');
    if (!bearer) return res.status(401).json({ success: false, message: 'Bearer token required' });
    const auth = getClient();
    if (!auth) return res.status(503).json({ success: false, message: 'Supabase not configured' });
    try {
      const { data, error } = await auth.auth.getUser(bearer[1]);
      if (error || !data?.user || data.user.is_anonymous) {
        return res.status(401).json({ success: false, message: 'Invalid Supabase token' });
      }
      return res.json({ success: true, supabase_user_id: data.user.id });
    } catch (err) {
      console.error('Supabase verification unavailable:', err.name);
      return res.status(503).json({ success: false, message: 'Verification service unavailable' });
    }
  });
};
'@
$anchor = '// فحص جاهزية API عبر استعلام بسيط لقاعدة البيانات، ويستخدمه التشغيل ومراقبة الخدمة.'
if (!$app.Contains($anchor)) { throw 'Could not locate stable insertion anchor; no files modified.' }
$backupDir = Join-Path $root ".tmp"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$backup = Join-Path $backupDir "app.js.before-supabase.bak"
if (!(Test-Path $backup)) { [System.IO.File]::WriteAllText($backup, $app, (New-Object System.Text.UTF8Encoding($false))) }
[System.IO.File]::WriteAllText($middlewarePath, $middleware, (New-Object System.Text.UTF8Encoding($false)))
$app = $app.Replace($anchor, "// Optional: verify Supabase tokens without altering existing Mazad sessions.`n$integration`n$anchor")
[System.IO.File]::WriteAllText($appPath, $app, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Added GET /api/supabase/verify, without replacing existing auth.'
Write-Host 'Next: node --check backend/src/app.js; node --check backend/src/middleware/supabaseVerify.js; npm.cmd test'
