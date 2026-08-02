# AI Studio 服务器部署打包脚本
$ErrorActionPreference = "Stop"
$root = "d:/项目/aiDemo/aiProject"

Write-Host "=== AI Studio 打包脚本 ===" -ForegroundColor Cyan
Write-Host ""

# 1. 清理旧的 zip
Write-Host "[1/4] 清理旧文件..." -ForegroundColor Yellow
Remove-Item "$root\deploy-*.zip" -Force -ErrorAction SilentlyContinue

# 2. 创建临时目录
Write-Host "[2/4] 准备打包文件..." -ForegroundColor Yellow
$tmpDir = "$root\_deploy_tmp"
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

# 3. 复制必要文件到临时目录
Write-Host "[3/4] 复制项目文件..." -ForegroundColor Yellow

# --- 前端构建产物 ---
Copy-Item "$root\dist" "$tmpDir\dist" -Recurse -Force

# --- 前端源码 ---
Copy-Item "$root\src" "$tmpDir\src" -Recurse -Force
Copy-Item "$root\public" "$tmpDir\public" -Recurse -Force

# --- 后端 API (排除 node_modules 和生成的媒体文件) ---
New-Item -ItemType Directory -Force -Path "$tmpDir\api" | Out-Null

# 复制 api 根目录文件（含子目录初始结构）
$apiExclude = @(
    'node_modules', '.git', 'public\videos', 'public\images', 'public\uploads',
    'data\temp_videos', 'data\*.json'
)
Get-ChildItem "$root\api" -File | ForEach-Object {
    Copy-Item $_.FullName "$tmpDir\api\" -Force
}
# 复制 api 子目录（排除大型生成文件）
$apiSubDirs = @('public', 'data', 'routes', 'services', 'utils', 'middleware')
foreach ($sub in $apiSubDirs) {
    $srcPath = "$root\api\$sub"
    if (Test-Path $srcPath) {
        Copy-Item $srcPath "$tmpDir\api\$sub" -Recurse -Force -ErrorAction SilentlyContinue
    }
}
# 清理生成的媒体文件
Get-ChildItem "$tmpDir\api\public" -Recurse -Include *.mp4, *.png, *.jpg, *.jpeg, *.webp, *.gif -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem "$tmpDir\api\data" -Recurse -Include *.json, *.mp4, *.png, *.jpg -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

# 创建必要的空目录
@(
    "$tmpDir\api\public\images",
    "$tmpDir\api\public\uploads",
    "$tmpDir\api\public\videos",
    "$tmpDir\api\data\temp_videos"
) | ForEach-Object {
    New-Item -ItemType Directory -Force -Path $_ | Out-Null
}

# --- 配置文件 ---
@(
    '.env', 'package.json', 'pnpm-lock.yaml',
    'tsconfig.json', 'vite.config.ts', 'index.html',
    'postcss.config.js', 'tailwind.config.js', 'nodemon.json',
    'hermes.toml', 'nginx.win.conf', 'redis.conf',
    'Dockerfile.backend', 'docker-compose.yml'
) | ForEach-Object {
    if (Test-Path "$root\$_") {
        Copy-Item "$root\$_" "$tmpDir\$_" -Force
    }
}

# --- 服务器适配：移除 hermes-agent（需要 Python，服务器不装） ---
Write-Host "  [适配] 移除 hermes-agent 依赖..." -ForegroundColor DarkGray
$pkgJson = Get-Content "$tmpDir\package.json" -Raw | ConvertFrom-Json
$pkgJson.PSObject.Properties.Remove('dependencies')
$pkgJson | Add-Member -NotePropertyName 'dependencies' -NotePropertyValue @{} -Force
# 重新构建 dependencies，跳过 hermes-agent
$origPkg = Get-Content "$root\package.json" -Raw | ConvertFrom-Json
$newDeps = @{}
$origPkg.dependencies.PSObject.Properties | ForEach-Object {
    if ($_.Name -ne 'hermes-agent') {
        $newDeps[$_.Name] = $_.Value
    }
}
$pkgJson.dependencies = $newDeps
$pkgJson | ConvertTo-Json -Depth 10 | Set-Content "$tmpDir\package.json" -Encoding UTF8

# 服务器适配：hermes.ts 跳过 Hermes CLI 检查
$hermesTs = Get-Content "$tmpDir\api\routes\hermes.ts" -Raw -Encoding UTF8
$hermesTs = $hermesTs -replace '(?s)function checkHermesInstalled\(\).*?^}', "function checkHermesInstalled(): boolean {`n  return false; // 服务器端无 Hermes CLI，统一用 DeepSeek API`n}"
Set-Content "$tmpDir\api\routes\hermes.ts" -Value $hermesTs -Encoding UTF8 -NoNewline

# --- 启动/停止脚本 ---
@('服务器启动.bat', '服务器停止.bat', '启动项目.bat', '停止项目.bat') | ForEach-Object {
    if (Test-Path "$root\$_") {
        Copy-Item "$root\$_" "$tmpDir\$_" -Force
    }
}

# --- 文档 ---
if (Test-Path "$root\DEPLOY_WINDOWS.md") {
    Copy-Item "$root\DEPLOY_WINDOWS.md" "$tmpDir\DEPLOY_WINDOWS.md" -Force
}

# --- scripts 目录 ---
if (Test-Path "$root\scripts") {
    Copy-Item "$root\scripts" "$tmpDir\scripts" -Recurse -Force -ErrorAction SilentlyContinue
}

# 4. 压缩
Write-Host "[4/4] 压缩打包..." -ForegroundColor Yellow
$timestamp = (Get-Date).ToString('yyyyMMdd-HHmm')
$zipName = "ai-studio-deploy-${timestamp}.zip"
$zipPath = "$root\$zipName"

Compress-Archive -Path "$tmpDir\*" -DestinationPath $zipPath -Force

# 清理临时目录
Remove-Item $tmpDir -Recurse -Force

$size = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  打包完成!" -ForegroundColor Green
Write-Host "  文件: $zipName" -ForegroundColor Green
Write-Host "  大小: $size MB" -ForegroundColor Green
Write-Host "  路径: $zipPath" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "上传到服务器后执行：" -ForegroundColor Cyan
Write-Host "  cd C:\ai-project"
Write-Host "  Expand-Archive -Force ai-studio-deploy.zip -DestinationPath ."
Write-Host "  pnpm install"
Write-Host "  双击 服务器启动.bat"
