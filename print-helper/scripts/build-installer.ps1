[CmdletBinding()]
param(
    [string]$CompilerPath,
    [switch]$CheckPrerequisiteOnly
)

$ErrorActionPreference = 'Stop'
$officialInstruction = 'Inno Setup 未安装。请从官方页面 https://jrsoftware.org/isdl.php 下载并手动安装 Inno Setup 6，然后重新运行此脚本。脚本不会自动下载或安装软件。'
$candidates = @()
if ($CompilerPath) { $candidates += $CompilerPath }
if ($env:INNO_SETUP_COMPILER) { $candidates += $env:INNO_SETUP_COMPILER }
if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe') }
if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe') }
if (${env:ProgramFiles(x86)}) { $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 7\ISCC.exe') }
if ($env:ProgramFiles) { $candidates += (Join-Path $env:ProgramFiles 'Inno Setup 7\ISCC.exe') }

$compiler = $candidates | Where-Object { $_ -and (Split-Path -Leaf $_) -ieq 'ISCC.exe' -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $compiler) { throw $officialInstruction }

Write-Host "Inno Setup compiler: $compiler"
if ($CheckPrerequisiteOnly) { exit 0 }

$helperRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = Split-Path -Parent $helperRoot
$project = Join-Path $helperRoot 'src\LabelPrintHelper\LabelPrintHelper.csproj'
$installer = Join-Path $helperRoot 'installer\LabelPrintHelper.iss'
$artifact = Join-Path $repositoryRoot 'artifacts\LabelPrintHelper-Setup.exe'

& dotnet publish $project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false
if ($LASTEXITCODE -ne 0) { throw 'Label Print Helper 自包含发布失败。' }

& $compiler $installer
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup 编译失败。' }
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "安装包未生成：$artifact" }

$hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Installer: $artifact"
Write-Host "SHA-256: $hash"
