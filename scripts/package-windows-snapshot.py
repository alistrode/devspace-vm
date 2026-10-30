"""Archive an existing runtime folder, split for GitHub, and write Extract.cmd."""
import argparse, hashlib, zipfile, re
from pathlib import Path

def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()

def main():
 p=argparse.ArgumentParser();p.add_argument('--folder',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--name',default='DevSpace-Windows-x64-existing-20261030');a=p.parse_args()
 source=a.folder.resolve();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True);archive=out/(a.name+'.zip');records=[]
 if archive.exists() or list(out.glob(a.name+'.zip.*')):raise RuntimeError('Archive already exists; choose a new output directory')
 with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED,compresslevel=4,allowZip64=True) as z:
  for f in sorted(source.rglob('*')):
   if not f.is_file():continue
   rel=f.relative_to(source).as_posix()
   if rel=='state' or rel.startswith('state/'):raise RuntimeError('Private runtime state must not be distributed')
   if f.name in ['.git-credentials','auth.json'] or f.suffix.lower()=='.pfx':raise RuntimeError('Private configuration in runtime folder: '+rel)
   if f.name=='.npmrc' and (rel=='.npmrc' or re.search(r'(?i)(?:_authToken|_password|_auth)\s*=',f.read_text())):raise RuntimeError('Private npm configuration in runtime folder: '+rel)
   if f.suffix.lower()=='.pem' and b'PRIVATE KEY' in f.read_bytes():raise RuntimeError('Private key in runtime folder: '+rel)
   z.write(f,'DevSpace-Windows-x64/'+rel)
 checksum=sha(archive);size=archive.stat().st_size
 with archive.open('rb') as f:
  part=1
  while True:
   b=f.read(48*1024*1024)
   if not b:break
   dest=out/(archive.name+f'.{part:03}');dest.write_bytes(b);records.append((dest.name,len(b),hashlib.sha256(b).hexdigest()));part+=1
 lines=[checksum+'  '+archive.name]+[h+'  '+name for name,n,h in records]
 (out/'SHA256SUMS').write_text('\n'.join(lines)+'\n')
 ps="""$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$zip=Join-Path $root '__ARCHIVE__'
$parts=@(Get-ChildItem -LiteralPath $root -Filter '__ARCHIVE__.*' | Sort-Object Name)
if(-not $parts.Count){throw 'Missing archive parts. Download all parts into this folder.'}
$output=[IO.File]::Create($zip)
try{foreach($part in $parts){$input=[IO.File]::OpenRead($part.FullName);try{$input.CopyTo($output)}finally{$input.Dispose()}}}finally{$output.Dispose()}
if((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne '__SHA__'){Remove-Item -LiteralPath $zip;throw 'Archive checksum mismatch; download all parts again.'}
Expand-Archive -LiteralPath $zip -DestinationPath $root -Force
Write-Host 'Extracted DevSpace-Windows-x64. Open its Start-Local.cmd when ready.'
""".replace('__ARCHIVE__',archive.name).replace('__SHA__',checksum)
 (out/'Extract.ps1').write_text(ps)
 (out/'Extract.cmd').write_bytes(b'@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Extract.ps1"\r\nif errorlevel 1 pause\r\n')
 archive.unlink()
 print('Archive:',a.name,'bytes:',size,'sha256:',checksum,flush=True)
 for name,n,h in records:print(name,n,h,flush=True)

if __name__=='__main__':main()
