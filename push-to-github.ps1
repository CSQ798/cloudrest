<#
    把「云卷云舒」推到 GitHub
    ---------------------------------------------------------------
    为什么需要你自己跑一下：推送要 GitHub 登录，而登录必须由人在浏览器里点一次
    （Git Credential Manager 会弹出登录窗）。登录成功后凭据会存进 Windows 凭据管理器，
    以后再推就不用再登了。

    用法：
        1. 先在 https://github.com/new 建一个**空**仓库（Public 或 Private 都行，
           千万不要勾选 Add README / .gitignore / license —— 勾了会与本地冲突）
        2. 右键本文件 -> 使用 PowerShell 运行；或在本目录执行：
               powershell -ExecutionPolicy Bypass -File ".\push-to-github.ps1"
        3. 按提示输入仓库名（默认 cloudrest，与你在 GitHub 上建的一致）

    参数：
        -Repo     仓库名（默认 yunjuanshuyu）
        -User     GitHub 用户名（默认 CSQ798）
        -Private   加了就是私有仓库
#>
[CmdletBinding()]
param(
    [string]$Repo = 'cloudrest',
    [string]$User = 'CSQ798',
    [switch]$Private
)

$ErrorActionPreference = 'Stop'
function Ok($t)   { Write-Host "   [OK] $t" -ForegroundColor Green }
function Step($t) { Write-Host "`n>> $t" -ForegroundColor Cyan }
function Bad($t)  { Write-Host "   [XX] $t" -ForegroundColor Red }

$root = $PSScriptRoot
Set-Location $root

Write-Host '====================================================='
Write-Host '  云卷云舒  ->  GitHub'
Write-Host '====================================================='

Step '检查 git 与仓库'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Bad '没装 git：https://git-scm.com/download/win'; exit 1 }
if (-not (Test-Path (Join-Path $root '.git'))) { Bad '这个目录不是 git 仓库'; exit 1 }
git rev-parse --verify HEAD | Out-Null
Ok ("本地已有 " + (git rev-list --count HEAD) + " 个提交")

# 这台机器的 Windows 证书存储对 git 的 schannel 后端不可用
# （报 schannel: AcquireCredentialsHandle failed），改用 git 自带的 openssl。
Step '设置 TLS 后端（本仓库）'
git config http.sslBackend openssl
Ok 'http.sslBackend = openssl'

Step '设置远端'
$url = "https://github.com/$User/$Repo.git"
$has = (git remote) -contains 'origin'
if ($has) { git remote set-url origin $url } else { git remote add origin $url }
Ok "origin -> $url"

Step '确认远端存在（此时会弹出 GitHub 登录窗）'
git ls-remote --heads origin
if ($LASTEXITCODE -ne 0) {
    Bad "连不上 $url —— 仓库要先在 https://github.com/new 建好（名字要一字不差）"
    exit 1
}
Ok '远端可达'

Step '推送'
git branch -M main
git push -u origin main
if ($LASTEXITCODE -ne 0) { Bad '推送失败，把上面的报错原文发我'; exit 1 }

Write-Host ''
Ok "完成：https://github.com/$User/$Repo"
Write-Host '   以后本地改了东西，回来跑：git add -A; git commit -m "说明"; git push'
