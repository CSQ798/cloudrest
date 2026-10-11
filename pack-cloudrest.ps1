# 打包 cloudrest 部署包（Windows PowerShell 5.1 版）
#
# 为什么不用 Compress-Archive：
#   PS 5.1 的 Compress-Archive 会把条目名写成 `a\b\c.txt`（反斜杠）。
#   反斜杠在 zip 规范里是非法分隔符，WSL/Linux 下 unzip 会解出一个
#   名字里带反斜杠的怪文件，等于包废了。
#   所以这里手工用 ZipArchive 建条目，条名一律用正斜杠。
#
# 用法（在仓库根目录、也就是本文件所在目录执行）：
#   powershell -ExecutionPolicy Bypass -File .\pack-cloudrest.ps1
#
# ⚠ 本文件必须存成 **UTF-8 with BOM**。
#   Windows PowerShell 5.1 没有 BOM 时会按本地代码页（GBK）读，
#   于是下面这些中文注释会被解成乱码，连字符串引号都对不上，
#   报出来的是「The string is missing the terminator」这种莫名其妙的语法错。
#   用编辑器改完本文件后，记得确认 BOM 还在；命令行补 BOM：
#     $p='.\pack-cloudrest.ps1'
#     $t=[IO.File]::ReadAllText($p,[Text.UTF8Encoding]::new($false))
#     [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($true))

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = $PSScriptRoot
$src  = Join-Path $root 'cloudrest'
$pkg  = Join-Path $root 'cloudrest-pkg'
$dst  = Join-Path $pkg  'cloudrest'
$zip  = Join-Path $root 'cloudrest.zip'

# ── 1. 白名单重建包目录（绝不带上 .env / .dev.vars / node_modules / .wrangler） ──
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Path $dst | Out-Null

$files = @(
  'worker.mjs', 'pages-entry.mjs', 'build-dashboard.mjs', 'doctor.mjs',
  'package.json', 'package-lock.json',
  'wrangler.toml', 'wrangler.worker.toml',
  '.dev.vars.example', '.gitignore', 'README.md', 'DEPLOY-CLOUDFLARE.md', 'ACCOUNTS.md'
)
$dirs = @('server', 'public', 'functions', 'migrations', '.test')

foreach ($f in $files) { Copy-Item (Join-Path $src $f) (Join-Path $dst $f) -Force }
foreach ($d in $dirs)  { Copy-Item (Join-Path $src $d) (Join-Path $dst $d) -Recurse -Force }

# ── 1b. 现场构建「拖拽上传」那个 zip（工具不在包外，必须由源码现打） ──
#    它把后端打成单个 _worker.js，这样控制台的拖拽上传也能带上后端
#    （控制台不编译 functions/ 目录，这是 Cloudflare 官方明确的限制）。
Write-Host "`n构建拖拽上传包" -ForegroundColor Cyan
Push-Location $src
try {
  node build-dashboard.mjs
  if ($LASTEXITCODE -ne 0) { throw "build-dashboard.mjs 失败" }
} finally { Pop-Location }

$dragZip = Join-Path $src 'cloudrest-拖拽上传.zip'
if (-not (Test-Path $dragZip)) { throw "没有生成 cloudrest-拖拽上传.zip" }
Copy-Item $dragZip (Join-Path $pkg 'cloudrest-拖拽上传.zip') -Force
Write-Host "  ✓ 已放到包里：cloudrest-拖拽上传.zip" -ForegroundColor Green
foreach ($t in @('dist-upload', 'cloudrest-拖拽上传.zip')) {
  $p = Join-Path $dst $t
  if (Test-Path $p) { Remove-Item -Recurse -Force $p }
}

# ── 2. 出厂前检查：危险文件与密钥 ──
Write-Host "`n检查包内容" -ForegroundColor Cyan
foreach ($bad in @('.env', '.dev.vars', 'node_modules', '.wrangler')) {
  if (Test-Path (Join-Path $dst $bad)) { throw "包里出现了 $bad —— 必须排除" }
}
$hits = Get-ChildItem -Recurse -Force -File $dst |
        Select-String -Pattern 'sk-98cbe5', 'sk-[a-zA-Z0-9]{28,}' -List -ErrorAction SilentlyContinue
if ($hits) {
  $hits | ForEach-Object { Write-Host "  ✗ 疑似密钥 $($_.Path):$($_.LineNumber)" }
  throw '包里有密钥，停止打包'
}
Write-Host "  ✓ 无 .env / .dev.vars / node_modules / .wrangler" -ForegroundColor Green
Write-Host "  ✓ 未出现任何 sk- 形式的密钥" -ForegroundColor Green

# ── 3. 写 zip：条目名一律用正斜杠 ──
if (Test-Path $zip) { Remove-Item -Force $zip }

$out = [System.IO.File]::Open($zip, [System.IO.FileMode]::CreateNew)
try {
  $archive = New-Object System.IO.Compression.ZipArchive($out, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $pkgFull = (Resolve-Path $pkg).Path.TrimEnd('\')
    $all = Get-ChildItem -Recurse -Force -File $pkg

    foreach ($f in $all) {
      # 相对 cloudrest-pkg 的路径，换成正斜杠 → 顶层就是「开始这里.txt」与「cloudrest/」
      $rel = $f.FullName.Substring($pkgFull.Length + 1).Replace('\', '/')
      $entry = $archive.CreateEntry($rel, [System.IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = $f.LastWriteTime
      $in = [System.IO.File]::OpenRead($f.FullName)
      try {
        $es = $entry.Open()
        try { $in.CopyTo($es) } finally { $es.Dispose() }
      } finally { $in.Dispose() }
    }
  } finally { $archive.Dispose() }
} finally { $out.Dispose() }

# ── 4. 回读校验 ──
$read = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
  $names = $read.Entries | ForEach-Object { $_.FullName }
} finally { $read.Dispose() }

Write-Host "`nzip：$zip" -ForegroundColor Cyan
Write-Host ("  {0} 个条目，{1:N1} KB" -f $names.Count, ((Get-Item $zip).Length / 1KB))
$bad = $names | Where-Object { $_.Contains('\') }
if ($bad) { throw "有 $($bad.Count) 个条目名里含反斜杠，WSL 下会解坏" }
Write-Host "  ✓ 全部条目名使用正斜杠（WSL / Linux 可正常解压）" -ForegroundColor Green
Write-Host "  ✓ 顶层：$((($names | Where-Object { $_ -notmatch '/' }) -join '、'))"
$names | Sort-Object | ForEach-Object { "    $_" }
