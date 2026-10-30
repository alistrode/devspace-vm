"""Assemble the archived Windows runtime. Does not compile or launch DevSpace."""
import argparse, hashlib, json, shutil, subprocess, sys, urllib.request, zipfile
from pathlib import Path

TOOLS = [
 ('node-v24.14.0-win-x64.zip','https://nodejs.org/dist/v24.14.0/node-v24.14.0-win-x64.zip','313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66'),
 ('cloudflared-windows-amd64.exe','https://github.com/cloudflare/cloudflared/releases/download/2026.7.3/cloudflared-windows-amd64.exe','8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841'),
 ('fd-v10.3.0-x86_64-pc-windows-msvc.zip','https://github.com/sharkdp/fd/releases/download/v10.3.0/fd-v10.3.0-x86_64-pc-windows-msvc.zip','318aa2a6fa664325933e81fda60d523fff29444129e91ebf0726b5b3bcd8b059'),
 ('PortableGit-2.51.0-64-bit.7z.exe','https://github.com/git-for-windows/git/releases/download/v2.51.0.windows.1/PortableGit-2.51.0-64-bit.7z.exe','a09b275d51ed3e829128e04cf4168fb54896cf6234bb30fecb8dc96a2bd321fa'),
 ('ripgrep-14.1.1-x86_64-pc-windows-msvc.zip','https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-pc-windows-msvc.zip','d0f534024c42afd6cb4d38907c25cd2b249b79bbe6cc1dbee8e3e37c2b6e25a1'),
]

def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()

def fetch(name,url,sha,cache):
 p=cache/name
 if not p.exists() or digest(p)!=sha:
  with urllib.request.urlopen(url,timeout=60) as r,p.open('wb') as f:shutil.copyfileobj(r,f)
 if digest(p)!=sha:raise RuntimeError('Download checksum mismatch: '+name)
 return p

def unzip_without_root(source,dest):
 with zipfile.ZipFile(source) as z:
  for f in z.infolist():
   parts=Path(f.filename).parts[1:]
   if not parts:continue
   p=dest.joinpath(*parts)
   if not p.resolve().is_relative_to(dest.resolve()):raise RuntimeError('Unsafe archive member')
   if f.is_dir():p.mkdir(parents=True,exist_ok=True)
   else:
    p.parent.mkdir(parents=True,exist_ok=True)
    with z.open(f) as a,p.open('wb') as b:shutil.copyfileobj(a,b)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--destination',type=Path,required=True);ap.add_argument('--cache',type=Path,required=True);ap.add_argument('--reuse-dependencies',action='store_true');ap.add_argument('--sevenzip',default=shutil.which('7zz') or shutil.which('7z'));a=ap.parse_args()
 root=Path(__file__).resolve().parents[1];dest=a.destination.resolve();cache=a.cache.resolve();cache.mkdir(parents=True,exist_ok=True);dest.mkdir(parents=True,exist_ok=True)
 for name in ['package.json','package-lock.json','LICENSE','README.md','start-devspace-public.bat','start-devspace-public.ps1','launch-devspace-window.ps1']:
  shutil.copyfile(root/name,dest/name)
 shutil.copytree(root/'release/existing-dist',dest/'dist',dirs_exist_ok=True)
 if not a.reuse_dependencies:
  subprocess.run(['npm','ci','--omit=dev','--ignore-scripts','--os=win32','--cpu=x64','--no-audit','--no-fund'],cwd=dest,check=True)
 tools=dest/'.tools';tools.mkdir(exist_ok=True)
 downloaded={name:fetch(name,url,sha,cache) for name,url,sha in TOOLS}
 unzip_without_root(downloaded[TOOLS[0][0]],tools/'node')
 shutil.copyfile(downloaded[TOOLS[1][0]],tools/'cloudflared.exe')
 for name,key in [('fd',2),('rg',4)]:
  target=cache/(name+'-unpacked');unzip_without_root(downloaded[TOOLS[key][0]],target)
  (tools/'bin').mkdir(exist_ok=True);shutil.copyfile(target/(name+'.exe'),tools/'bin'/(name+'.exe'))
  licenses=tools/'licenses'/name;licenses.mkdir(parents=True,exist_ok=True)
  for f in target.iterdir():
   if f.is_file() and ('LICENSE' in f.name.upper() or f.name=='COPYING'):shutil.copyfile(f,licenses/f.name)
 git=tools/'Git'
 if not (git/'.archive-sha256').exists():
  if not a.sevenzip:raise RuntimeError('Install 7-Zip or pass --sevenzip PATH')
  subprocess.run([a.sevenzip,'x','-y','-o'+str(git),str(downloaded[TOOLS[3][0]])],check=True,stdout=subprocess.DEVNULL)
  (git/'.archive-sha256').write_text(TOOLS[3][2]+'\n')
 (git/'etc/gitconfig').write_text('[diff "astextplain"]\n\ttextconv = astextplain\n[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\tsmudge = git-lfs smudge -- %f\n\tprocess = git-lfs filter-process\n\trequired = true\n[http]\n\tsslBackend = schannel\n[core]\n\tautocrlf = true\n\tfscache = true\n\tsymlinks = false\n[pull]\n\trebase = false\n[credential]\n\thelper = manager\n[credential "https://dev.azure.com"]\n\tuseHttpPath = true\n[init]\n\tdefaultBranch = master\n')
 cf=tools/'licenses/cloudflared';cf.mkdir(parents=True,exist_ok=True)
 with urllib.request.urlopen('https://raw.githubusercontent.com/cloudflare/cloudflared/2026.7.3/LICENSE',timeout=30) as r:(cf/'LICENSE').write_bytes(r.read())
 (tools/'bin/devspace.cmd').write_bytes(b'@echo off\r\n"%~dp0..\\node\\node.exe" "%~dp0..\\..\\dist\\cli.js" %*\r\n')
 launcher='''@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "PATH=%~dp0.tools\\bin;%~dp0.tools\\node;%~dp0.tools\\Git\\cmd;%~dp0.tools\\Git\\usr\\bin;%~dp0.tools\\Git\\mingw64\\bin;%~dp0.tools;%PATH%"
set "DEVSPACE_STATE_DIR=%~dp0state"
set "PI_OFFLINE=1"
if not defined HOST set "HOST=127.0.0.1"
if not defined PORT set "PORT=7676"
if not exist "%DEVSPACE_STATE_DIR%\\auth.json" (
  "%~dp0.tools\\node\\node.exe" "%~dp0dist\\cli.js" init
  if errorlevel 1 goto failed
)
echo Owner password file: "%DEVSPACE_STATE_DIR%\\auth.json"
"%~dp0.tools\\node\\node.exe" "%~dp0dist\\cli.js" serve
:failed
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
'''
 (dest/'Start-Local.cmd').write_bytes(launcher.replace('\n','\r\n').encode())
 readme='''DevSpace existing Windows x64 runtime snapshot (2026-10-30)

Extract the entire folder, then open Start-Local.cmd.
Requires Windows 10/11 x64. Node.js, production dependencies, Git Bash,
fd, ripgrep and cloudflared are included. No global npm installation is required.
State is stored in this folder's state directory. The first start initializes
an Owner password in state/auth.json. Open http://127.0.0.1:7676/authorize
when configuring an MCP client. Keep the auth file private.

This archive preserves the existing VMware dist build dated
2026-08-11 19:46:56 Asia/Shanghai. The branch source was subsequently
modified at 21:35:30 on that date. It has NOT been rebuilt from that newer
source, and Windows startup/MCP operation has NOT been acceptance tested.
The packaging-only Start-Local.cmd is new. Original public-tunnel launchers
are preserved and retain their original per-user state/process behavior.

Production dependencies were restored from the source package-lock.json
with lifecycle scripts disabled. Node 24.14.0, cloudflared 2026.7.3 and fd
10.3.0 match the component hashes observed in the VM. PortableGit 2.51.0
is an official portable replacement for the VM's installed Git 2.51.0.
Ripgrep 14.1.1 is included for the grep tool. See the branch HANDOFF.md,
scripts/assemble-existing-windows.py and package-lock.json for provenance.
'''
 (dest/'README-RUN.txt').write_text(readme)
 # Dependency packages include their redistributable license files.
 print('Assembled existing Windows runtime; application was not launched.',flush=True)

if __name__=='__main__':main()
