$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
    & node scripts/build-extension.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Extension build failed.' }
    $extensionRoot = Join-Path $repoRoot 'dist\browser-extension'
    $metadata = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw -Encoding utf8 | ConvertFrom-Json
    $archive = Join-Path $repoRoot ('dist\' + $metadata.productName + '-Edge-Chrome.zip')
    Compress-Archive -Path (Join-Path $extensionRoot '*') -DestinationPath $archive -CompressionLevel Optimal -Force
    $files = @(Get-ChildItem -LiteralPath $extensionRoot -Recurse -File | ForEach-Object {
        [ordered]@{path=$_.FullName.Substring($extensionRoot.Length + 1).Replace('\', '/'); bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
    })
    $report = [ordered]@{name=(Split-Path $archive -Leaf); bytes=(Get-Item $archive).Length; sha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant(); files=$files}
    $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $repoRoot 'dist\extension-release-manifest.json') -Encoding utf8
    [pscustomobject]$report | Select-Object name,bytes,sha256 | Format-List
} finally { Pop-Location }
