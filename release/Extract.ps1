$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$zip=Join-Path $root 'DevSpace-Windows-x64-existing-20261030.zip'
$parts=@(Get-ChildItem -LiteralPath $root -Filter 'DevSpace-Windows-x64-existing-20261030.zip.*' | Sort-Object Name)
if(-not $parts.Count){throw 'Missing archive parts. Download all parts into this folder.'}
$output=[IO.File]::Create($zip)
try{foreach($part in $parts){$input=[IO.File]::OpenRead($part.FullName);try{$input.CopyTo($output)}finally{$input.Dispose()}}}finally{$output.Dispose()}
if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '5fda1a408886b77f56abf138628624611c800755e169ae47d7227a8555c01cfe'){Remove-Item -LiteralPath $zip;throw 'Archive checksum mismatch; download all parts again.'}
Expand-Archive -LiteralPath $zip -DestinationPath $root -Force
Write-Host 'Extracted DevSpace-Windows-x64. Open its Start-Local.cmd when ready.'
