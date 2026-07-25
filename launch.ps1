# Second Brain Dashboard - One-Click Launcher
# ============================================

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $projectDir "server.js"
$logsDir = Join-Path $projectDir "logs"

# Create logs directory if missing
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir | Out-Null
}

# Kill any existing process on port 3000
try {
    $conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
    if ($conn) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped previous server instance."
        Start-Sleep -Milliseconds 800
    }
} catch { }

# Start Node.js server silently in background
Write-Host "Starting Second Brain server..."
$logFile   = Join-Path $logsDir "server.log"
$errorFile = Join-Path $logsDir "error.log"

Start-Process -FilePath "node" `
    -ArgumentList "`"$serverScript`"" `
    -WorkingDirectory $projectDir `
    -RedirectStandardOutput $logFile `
    -RedirectStandardError $errorFile `
    -WindowStyle Hidden

# Wait for server to be ready (max 8 seconds)
$ready = $false
for ($i = 0; $i -lt 16; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 1 -UseBasicParsing -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
}

if ($ready) {
    Write-Host "Server is ready!"
} else {
    Write-Host "Server starting... opening browser anyway."
}

# Open browser
Start-Process "http://localhost:3000"

Write-Host ""
Write-Host "========================================"
Write-Host "  Second Brain running at localhost:3000"
Write-Host "  Logs: $logsDir"
Write-Host "========================================"
Write-Host ""
Write-Host "Press any key to close this window..."
Write-Host "(Server will keep running in background)"
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
