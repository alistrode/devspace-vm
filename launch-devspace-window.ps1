[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BatPath
)

$ErrorActionPreference = 'Stop'
$resolvedBat = (Resolve-Path -LiteralPath $BatPath).Path
$stateDir = Join-Path $env:USERPROFILE '.devspace\auto-start'
$windowPidFile = Join-Path $stateDir 'launcher-window.pid'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

# 只关闭上一次由本启动器记录的窗口。先核对名称和完整命令行，
# 防止 PID 被 Windows 重用后误杀其他程序或当前新窗口。
if (Test-Path -LiteralPath $windowPidFile) {
    $oldPidText = Get-Content -LiteralPath $windowPidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($oldPidText -match '^\d+$') {
        $oldPid = [int]$oldPidText
        $oldWindow = Get-CimInstance Win32_Process -Filter "ProcessId=$oldPid" -ErrorAction SilentlyContinue
        if (
            $oldWindow -and
            $oldWindow.Name -eq 'cmd.exe' -and
            $oldWindow.CommandLine -like "*$resolvedBat*" -and
            $oldWindow.CommandLine -like '*__DEVSPACE_INNER__*'
        ) {
            Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 300
        }
    }
}

# 兼容升级前没有 PID 文件的旧内层窗口。当前外层 BAT 不带此标记，
# 因此这里只会命中旧的 DevSpace 结果窗口，不会命中新窗口。
$untrackedOldWindows = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -eq 'cmd.exe' -and
    $_.CommandLine -like "*$resolvedBat*" -and
    $_.CommandLine -like '*__DEVSPACE_INNER__*'
}
foreach ($oldWindow in $untrackedOldWindows) {
    Stop-Process -Id $oldWindow.ProcessId -Force -ErrorAction SilentlyContinue
}
if ($untrackedOldWindows) { Start-Sleep -Milliseconds 300 }

# 命令必须以 call 开头。这样 BAT 路径即使包含空格，cmd.exe 也不会
# 把开头和结尾的双引号错误剥离。
$cmdArguments = @(
    '/d',
    '/c',
    $resolvedBat,
    '__DEVSPACE_INNER__'
)
$newWindow = Start-Process -FilePath "$env:SystemRoot\System32\cmd.exe" `
    -ArgumentList $cmdArguments -WorkingDirectory (Split-Path -Parent $resolvedBat) -PassThru

Set-Content -LiteralPath $windowPidFile -Value $newWindow.Id -Encoding ascii
