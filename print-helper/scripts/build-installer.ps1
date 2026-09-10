[CmdletBinding()]
param(
    [string]$CompilerPath,
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory,
    [switch]$CheckPrerequisiteOnly
)

$ErrorActionPreference = 'Stop'
$officialInstruction = 'Inno Setup is not installed. Download Inno Setup 6 from https://jrsoftware.org/isdl.php, install it manually, and run this script again. This script never downloads or installs software.'
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
$versionManifest = Get-Content -LiteralPath (Join-Path $helperRoot 'version.json') -Raw | ConvertFrom-Json
if ($versionManifest.helperVersion -cne $Version) {
    throw "Version mismatch: argument is $Version but print-helper/version.json is $($versionManifest.helperVersion)."
}
if ($versionManifest.protocolVersion -ne 1) {
    throw "Unsupported print protocol version: $($versionManifest.protocolVersion)."
}

$resolvedOutputDirectory = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $OutputDirectory))
$repositoryPrefix = [System.IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') + '\'
if (-not $resolvedOutputDirectory.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputDirectory must be inside the current repository.'
}
[System.IO.Directory]::CreateDirectory($resolvedOutputDirectory) | Out-Null

$project = Join-Path $helperRoot 'src\LabelPrintHelper\LabelPrintHelper.csproj'
$installer = Join-Path $helperRoot 'installer\LabelPrintHelper.iss'
$publishDirectory = Join-Path $resolvedOutputDirectory "publish-$Version"
$artifact = Join-Path $resolvedOutputDirectory 'LabelPrintHelper-Setup.exe'
$checksum = Join-Path $resolvedOutputDirectory 'LabelPrintHelper-Setup.exe.sha256'

& dotnet publish $project -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:PublishTrimmed=false -p:Version=$Version -o $publishDirectory
if ($LASTEXITCODE -ne 0) { throw 'Label Print Helper self-contained publish failed.' }

& $compiler "/DMyAppVersion=$Version" "/DMyPublishDir=$publishDirectory" "/DMyOutputDir=$resolvedOutputDirectory" $installer
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compilation failed.' }
if (-not (Test-Path -LiteralPath $artifact -PathType Leaf)) { throw "Installer was not generated: $artifact" }

$hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($checksum, "$hash  LabelPrintHelper-Setup.exe`n", [System.Text.UTF8Encoding]::new($false))
Write-Host "Installer: $artifact"
Write-Host "SHA-256: $hash"
Write-Host "Checksum: $checksum"
