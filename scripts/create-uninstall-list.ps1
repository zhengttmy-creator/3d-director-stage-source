param([Parameter(Mandatory = $true)][string]$StageRoot)

$ErrorActionPreference = 'Stop'
$StageRoot = (Resolve-Path -LiteralPath $StageRoot).Path
$lines = [System.Collections.Generic.List[string]]::new()
foreach ($file in Get-ChildItem -LiteralPath $StageRoot -File -Recurse) {
    $relative = $file.FullName.Substring($StageRoot.Length + 1).Replace('$', '$$')
    $lines.Add('Delete "$INSTDIR\' + $relative + '"')
}
foreach ($directory in Get-ChildItem -LiteralPath $StageRoot -Directory -Recurse | Sort-Object { $_.FullName.Length } -Descending) {
    $relative = $directory.FullName.Substring($StageRoot.Length + 1).Replace('$', '$$')
    $lines.Add('RMDir "$INSTDIR\' + $relative + '"')
}
$destination = $StageRoot + '-uninstall.nsh'
[System.IO.File]::WriteAllLines($destination, $lines, [System.Text.UTF8Encoding]::new($true))
Write-Output $destination
