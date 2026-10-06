param(
    [string]$ElectronArchive,
    [string]$MakeNsis,
    [string]$ResourceEditor
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$metadata = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json
$electronVersion = $metadata.devDependencies.electron
$archiveName = "electron-v$electronVersion-win32-x64.zip"
if (-not $ElectronArchive) { $ElectronArchive = Join-Path $env:LOCALAPPDATA "electron\Cache\$archiveName" }
if (-not $MakeNsis) {
    $MakeNsis = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis') -Recurse -Filter makensis.exe |
        Where-Object { $_.Directory.Name -ne 'Bin' } | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $ResourceEditor) {
    $ResourceEditor = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign') -Recurse -Filter rcedit-x64.exe |
        Select-Object -First 1 -ExpandProperty FullName
}
foreach ($tool in @($ElectronArchive, $MakeNsis, $ResourceEditor)) {
    if (-not $tool -or -not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Missing Windows packaging dependency: $tool" }
}
$checksums = Get-Content -LiteralPath (Join-Path $repoRoot 'node_modules\electron\checksums.json') -Raw | ConvertFrom-Json
$archiveHash = (Get-FileHash -LiteralPath $ElectronArchive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($archiveHash -ne $checksums.$archiveName) { throw 'Electron archive checksum does not match the installed package.' }

Push-Location $repoRoot
try {
    & node scripts/build-vendor.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Application build failed.' }
    $distRoot = Join-Path $repoRoot 'dist'
    $stageRoot = Join-Path $distRoot ('d-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    Expand-Archive -LiteralPath $ElectronArchive -DestinationPath $stageRoot
    $executableName = $metadata.productName + '.exe'
    Rename-Item -LiteralPath (Join-Path $stageRoot 'electron.exe') -NewName $executableName
    $payloadRoot = Join-Path $stageRoot 'resources\app'
    New-Item -ItemType Directory -Path $payloadRoot -Force | Out-Null
    foreach ($directory in @('desktop', 'web', 'docs')) {
        $sourceRoot = Join-Path $repoRoot $directory
        foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -File -Recurse) {
            $relative = $file.FullName.Substring($sourceRoot.Length + 1)
            if ($directory -eq 'web' -and ($relative -match '^state[\\/]' -or $relative -match '^assets[\\/]captures[\\/]')) { continue }
            $destination = Join-Path (Join-Path $payloadRoot $directory) $relative
            New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $destination
        }
    }
    New-Item -ItemType Directory -Path (Join-Path $payloadRoot 'seed') | Out-Null
    foreach ($name in @('package.json', 'app.ico', 'THIRD_PARTY.md')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot $name) -Destination (Join-Path $payloadRoot $name)
    }
    & $ResourceEditor (Join-Path $stageRoot $executableName) --set-icon (Join-Path $repoRoot 'app.ico') --set-version-string ProductName $metadata.productName --set-version-string FileDescription $metadata.description --set-file-version $metadata.version --set-product-version $metadata.version
    if ($LASTEXITCODE -ne 0) { throw 'Failed to set executable metadata.' }

    $records = @(foreach ($file in Get-ChildItem -LiteralPath $payloadRoot -File -Recurse) {
        $relative = $file.FullName.Substring($payloadRoot.Length + 1).Replace('\', '/')
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $source = Join-Path $repoRoot $relative
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw "Payload differs from source: $relative" }
        [ordered]@{ path = $relative; bytes = $file.Length; sha256 = $hash }
    })
    $totalKiB = [math]::Ceiling((Get-ChildItem -LiteralPath $stageRoot -File -Recurse | Measure-Object -Property Length -Sum).Sum / 1024)
    $portable = Join-Path $distRoot ($metadata.productName + '-x64.exe')
    $installer = Join-Path $distRoot ($metadata.productName + '-Setup-x64.exe')
    & (Join-Path $PSScriptRoot 'create-uninstall-list.ps1') -StageRoot $stageRoot | Out-Null
    $defines = @("/DAPP_NAME=$($metadata.productName)", "/DAPP_VERSION=$($metadata.version)", "/DAPP_EXE=$executableName", "/DSTAGE_DIR=$stageRoot", "/DAPP_ICON=$(Join-Path $repoRoot 'app.ico')", "/DINSTALL_SIZE=$totalKiB")
    & $MakeNsis /V2 @defines "/DOUT_FILE=$portable" (Join-Path $PSScriptRoot 'windows-portable.nsi')
    if ($LASTEXITCODE -ne 0) { throw 'Portable packaging failed.' }
    & $MakeNsis /V2 @defines "/DOUT_FILE=$installer" (Join-Path $PSScriptRoot 'windows-installer.nsi')
    if ($LASTEXITCODE -ne 0) { throw 'Installer packaging failed.' }
    $guide = Join-Path $distRoot ($metadata.productName + '-使用教程.html')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs\user-guide.html') -Destination $guide
    $artifacts = @(foreach ($artifact in @($portable, $installer, $guide)) {
        [ordered]@{ name = Split-Path $artifact -Leaf; bytes = (Get-Item -LiteralPath $artifact).Length; sha256 = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    $manifest = [ordered]@{ product = $metadata.productName; version = $metadata.version; electron = $electronVersion; electronArchiveSha256 = $archiveHash; payloadRoot = $payloadRoot; sourceFilesVerified = $records.Count; artifacts = $artifacts; files = $records }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $distRoot 'desktop-release-manifest.json') -Encoding utf8
    $artifacts | ConvertTo-Json
    Write-Output "Verified payload: $payloadRoot"
} finally {
    Pop-Location
}
