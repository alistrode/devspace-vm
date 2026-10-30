[CmdletBinding()]
param(
    [string]$ProjectRoot,
    [int]$Port = 7676,
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) { $ProjectRoot = $PSScriptRoot }
$diagnosticLog = Join-Path $env:TEMP "devspace-auto-start-diagnostic-$PID.log"
Remove-Item -LiteralPath $diagnosticLog -Force -ErrorAction SilentlyContinue
try { Start-Transcript -Path $diagnosticLog -Force | Out-Null } catch { }

function Write-Step([string]$Message) {
    Write-Host "[DevSpace] $Message" -ForegroundColor Cyan
}

function Require-Command([string]$Name, [string]$Hint) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "未找到 $Name。$Hint"
    }
}

function Write-JsonUtf8([string]$Path, $Value) {
    $json = $Value | ConvertTo-Json -Depth 10
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $utf8NoBom)
}

function Stop-SavedProcess([string]$PidFile) {
    if (-not (Test-Path -LiteralPath $PidFile)) { return }
    $savedPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($savedPid -match '^\d+$') {
        Stop-Process -Id ([int]$savedPid) -Force -ErrorAction SilentlyContinue
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

function Wait-ForMatch([string]$Path, [string]$Pattern, [int]$Timeout, [System.Diagnostics.Process]$Process) {
    $started = Get-Date
    $nextProgress = 10
    while ($true) {
        if ($Process.HasExited) {
            $details = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
            throw "公网隧道进程在分配地址前退出。$details"
        }
        if (Test-Path -LiteralPath $Path) {
            $content = Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
            if (-not [string]::IsNullOrEmpty($content)) {
                $match = [regex]::Match($content, $Pattern)
                if ($match.Success) { return $match.Groups[1].Value.TrimEnd('/') }
            }
        }
        $elapsed = [int]((Get-Date) - $started).TotalSeconds
        if ($elapsed -ge $nextProgress) {
            Write-Host "  正在等待分配公网地址……已等待 ${elapsed} 秒" -ForegroundColor DarkGray
            $nextProgress += 10
        }
        Start-Sleep -Seconds 1
    }
}

function Read-ProcessLog([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    return Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
}

function Wait-ForLocalService(
    [int]$ServicePort,
    [int]$Timeout,
    [System.Diagnostics.Process]$Process,
    [string]$OutLog,
    [string]$ErrLog
) {
    $started = Get-Date
    while ($true) {
        if ($Process.HasExited) {
            $stdout = Read-ProcessLog $OutLog
            $stderr = Read-ProcessLog $ErrLog
            throw "本地 DevSpace 进程已退出（退出码：$($Process.ExitCode)）。`n--- stdout ---`n$stdout`n--- stderr ---`n$stderr"
        }
        try {
            $status = & curl.exe -s -o NUL -w '%{http_code}' --max-time 5 "http://127.0.0.1:$ServicePort/mcp"
            if ($status -eq '401') { return }
        } catch { }
        $elapsed = [int]((Get-Date) - $started).TotalSeconds
        if ($elapsed -ge $Timeout) {
            $stdout = Read-ProcessLog $OutLog
            $stderr = Read-ProcessLog $ErrLog
            throw "等待本地 DevSpace 服务超时（$Timeout 秒）。`n--- stdout ---`n$stdout`n--- stderr ---`n$stderr"
        }
        Start-Sleep -Seconds 1
    }
}

function Test-PublicEndpoint([string]$Name, [string]$Url, [int]$Attempts = 2) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        $status = $null
        try {
            $ErrorActionPreference = 'Continue'
            $status = & curl.exe -sS -o NUL -w '%{http_code}' --max-time 20 $Url 2>$null
        } finally {
            $ErrorActionPreference = 'Stop'
        }
        if ($status -eq '401') {
            Write-Host "  $Name 验证成功：HTTP 401（密码鉴权已启用）" -ForegroundColor Green
            return $true
        }
        Write-Host "  $Name 第 $attempt/$Attempts 次验证返回：${status}" -ForegroundColor Yellow
        Start-Sleep -Seconds ([Math]::Min(3 * $attempt, 12))
    }
    return $false
}

function Start-DevSpace([string]$NodeCommand, [string]$CliPath, [string]$OutLog, [string]$ErrLog, [string]$PidFile, [string]$PublicBaseUrl) {
    Remove-Item -LiteralPath $OutLog, $ErrLog -Force -ErrorAction SilentlyContinue
    $nodeArguments = '"' + $CliPath + '" serve'
    $previousPublicBaseUrl = $env:DEVSPACE_PUBLIC_BASE_URL
    try {
        $env:DEVSPACE_PUBLIC_BASE_URL = $PublicBaseUrl
        $process = Start-Process -FilePath $NodeCommand -ArgumentList $nodeArguments -WorkingDirectory $resolvedRoot -WindowStyle Hidden `
            -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog -PassThru
    } finally {
        if ($null -eq $previousPublicBaseUrl) { Remove-Item Env:DEVSPACE_PUBLIC_BASE_URL -ErrorAction SilentlyContinue }
        else { $env:DEVSPACE_PUBLIC_BASE_URL = $previousPublicBaseUrl }
    }
    Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ascii
    return $process
}

try {
    Write-Step '正在检查运行依赖'
    Require-Command node '请安装 Node.js 22 或更高版本。'
    Require-Command npm '请随 Node.js 安装 npm。'
    Require-Command devspace '请运行：npm install -g @waishnav/devspace'
    Require-Command curl.exe '请启用 Windows curl 组件。'
    Require-Command ssh.exe '请启用 Windows OpenSSH 客户端。'

    $cloudflaredCommand = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if (-not $cloudflaredCommand) {
        $fallback = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
        if (Test-Path -LiteralPath $fallback) {
            $cloudflaredExe = $fallback
        } else {
            throw '未找到 cloudflared。请运行：winget install Cloudflare.cloudflared'
        }
    } else {
        $cloudflaredExe = $cloudflaredCommand.Source
    }

    $nodeCommand = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
    $devspaceCli = Join-Path $PSScriptRoot 'dist\cli.js'
    if (-not (Test-Path -LiteralPath $devspaceCli)) { throw "未找到 DevSpace CLI：$devspaceCli" }
    $sshExe = (Get-Command ssh.exe).Source
    $resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

    $configDir = Join-Path $env:USERPROFILE '.devspace'
    $authPath = Join-Path $configDir 'auth.json'
    $runtimeDir = Join-Path $configDir 'auto-start'
    New-Item -ItemType Directory -Path $configDir, $runtimeDir -Force | Out-Null

    Write-Step '正在创建或更新配置及 Owner 密码'
    if (Test-Path -LiteralPath $authPath) {
        $auth = Get-Content -LiteralPath $authPath -Raw | ConvertFrom-Json
    } else {
        $auth = [pscustomobject]@{}
    }
    if (-not $auth.ownerToken) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        $auth | Add-Member -NotePropertyName ownerToken -NotePropertyValue ([Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')) -Force
    }
    Write-JsonUtf8 $authPath $auth


    $devspacePid = Join-Path $runtimeDir 'devspace.pid'
    $cloudflarePid = Join-Path $runtimeDir 'cloudflared.pid'
    $backupPid = Join-Path $runtimeDir 'backup-ssh.pid'
    Stop-SavedProcess $devspacePid
    Stop-SavedProcess $cloudflarePid
    Stop-SavedProcess $backupPid

    # PID files can be missing after an interrupted run. Remove only stale
    # tunnel processes that explicitly forward to this DevSpace port.
    $staleTunnels = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        ($_.Name -eq 'cloudflared.exe' -and $_.CommandLine -like "*127.0.0.1:$Port*") -or
        ($_.Name -eq 'ssh.exe' -and (
            $_.CommandLine -like "*127.0.0.1:$Port*" -or
            $_.CommandLine -like "*localhost:$Port*"
        ) -and (
            $_.CommandLine -like '*localhost.run*' -or
            $_.CommandLine -like '*pinggy.io*'
        ))
    }
    foreach ($staleTunnel in $staleTunnels) {
        Write-Step "正在停止残留的 $($staleTunnel.Name) 进程，PID：$($staleTunnel.ProcessId)"
        Stop-Process -Id $staleTunnel.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if ($staleTunnels) { Start-Sleep -Seconds 2 }

    $existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingListener) {
        Write-Step "正在停止占用端口 $Port 的旧服务"
        Stop-Process -Id $existingListener.OwningProcess -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    }

    Write-Step '正在启动本地 DevSpace'
    $devspaceOut = Join-Path $runtimeDir 'devspace.out.log'
    $devspaceErr = Join-Path $runtimeDir 'devspace.err.log'
    $devspaceProcess = Start-DevSpace $nodeCommand $devspaceCli $devspaceOut $devspaceErr $devspacePid "http://127.0.0.1:$Port"
    Wait-ForLocalService $Port 30 $devspaceProcess $devspaceOut $devspaceErr
    $actualListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    Set-Content -LiteralPath $devspacePid -Value $actualListener.OwningProcess -Encoding ascii

    Write-Step '正在创建 Cloudflare 主公网入口'
    $cloudflareOut = Join-Path $runtimeDir 'cloudflared.out.log'
    $cloudflareErr = Join-Path $runtimeDir 'cloudflared.err.log'
    Remove-Item -LiteralPath $cloudflareOut, $cloudflareErr -Force -ErrorAction SilentlyContinue
    $cloudflareProcess = Start-Process -FilePath $cloudflaredExe `
        -ArgumentList @('tunnel','--url',"http://127.0.0.1:$Port",'--protocol','quic') `
        -WindowStyle Hidden -RedirectStandardOutput $cloudflareOut -RedirectStandardError $cloudflareErr -PassThru
    Set-Content -LiteralPath $cloudflarePid -Value $cloudflareProcess.Id -Encoding ascii
    $primaryBase = Wait-ForMatch $cloudflareErr '(https://[a-z0-9-]+\.trycloudflare\.com)' $TimeoutSeconds $cloudflareProcess

    Write-Step '正在创建非 Cloudflare 备用公网入口'
    $backupOut = Join-Path $runtimeDir 'backup.out.log'
    $backupErr = Join-Path $runtimeDir 'backup.err.log'
    Remove-Item -LiteralPath $backupOut, $backupErr -Force -ErrorAction SilentlyContinue
    $sshArgs = @('-T','-o','StrictHostKeyChecking=accept-new','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=20','-o','ServerAliveCountMax=6','-R',"80:127.0.0.1:$Port",'nokey@localhost.run')
    $backupProcess = Start-Process -FilePath $sshExe -ArgumentList $sshArgs -WindowStyle Hidden `
        -RedirectStandardOutput $backupOut -RedirectStandardError $backupErr -PassThru
    Set-Content -LiteralPath $backupPid -Value $backupProcess.Id -Encoding ascii
    # localhost.run may emit a longer subdomain and occasionally include hyphens.
    # Match the complete HTTPS URL rather than assuming a fixed label length.
    $backupBase = Wait-ForMatch $backupOut '(https://[a-z0-9-]+\.[a-z0-9-]+\.life)' $TimeoutSeconds $backupProcess

    Write-Step '正在写入主备域名并重启 DevSpace'

    $actualListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($actualListener) {
        Stop-Process -Id $actualListener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    $devspaceProcess = Start-DevSpace $nodeCommand $devspaceCli $devspaceOut $devspaceErr $devspacePid $primaryBase
    Wait-ForLocalService $Port 30 $devspaceProcess $devspaceOut $devspaceErr
    $actualListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | Select-Object -First 1
    Set-Content -LiteralPath $devspacePid -Value $actualListener.OwningProcess -Encoding ascii

    $primaryUrl = "$primaryBase/mcp"
    $backupUrl = "$backupBase/mcp"
    Write-Step '正在验证主备公网入口'
    $primaryOk = Test-PublicEndpoint '主入口' $primaryUrl 2
    $backupOk = Test-PublicEndpoint '备用入口' $backupUrl 2
    if (-not $backupOk) { throw "备用公网入口验证失败：$backupUrl" }

    $resultPath = Join-Path $runtimeDir 'service-info.txt'
    $result = @(
        "主入口：$primaryUrl",
        "Owner 密码：$($auth.ownerToken)",
        "备用入口：$backupUrl",
        "本地入口：http://127.0.0.1:$Port/mcp",
        "主入口验证：$primaryOk",
        "备用入口验证：$backupOk",
        "生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    )
    $result | Set-Content -LiteralPath $resultPath -Encoding utf8

    Write-Host ''
    Write-Host '========== DEVSPACE 已准备就绪 ==========' -ForegroundColor Green
    Write-Host "主公网入口：$primaryUrl"
    Write-Host "Owner 密码：$($auth.ownerToken)"
    Write-Host "备用入口：  $backupUrl"
    Write-Host "本地入口：  http://127.0.0.1:$Port/mcp"
    Write-Host "结果文件：  $resultPath"
    if (-not $primaryOk) {
        Write-Warning 'Cloudflare 地址已生成，但无法从本机完成验证；已验证成功的备用入口可以使用。'
    }
    Stop-Transcript | Out-Null
    exit 0
} catch {
    Write-Host "[错误] $($_.Exception.Message)" -ForegroundColor Red
    if ($_.ScriptStackTrace) { Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray }
    Add-Content -LiteralPath $diagnosticLog -Value "ERROR: $($_.Exception.ToString())`nSTACK: $($_.ScriptStackTrace)" -ErrorAction SilentlyContinue
    Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
    exit 1
}
