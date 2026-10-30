# VMware DevSpace development snapshot

Source: `M:\devspace` in the VMware Windows 10 x64 guest, captured read-only on 2026-10-30.

This is the locally developed Owner-authenticated MCP version (`1.0.5`). Its latest core source changes are dated 2026-08-11 21:35:30 Asia/Shanghai. The separate `M:\devspace-main` directory contains upstream version `1.0.6` files dated 2026-08-08, predating these local changes.

The original checkout points to `Waishnav/devspace` commit `8cd2fba227454514f3ce8ef4848012753103e773`. This snapshot preserves the current working source, including local changes that were never committed in that checkout. It is archived in its own project branch.

All 33 source files were checked against SHA-256 hashes read from the virtual disk. Seventeen matching upstream files were retrieved directly from the pinned upstream commit; sixteen locally changed files were restored from the guest source snapshot. `SOURCE-MANIFEST.json` records every source path, size and hash.

The original 33 source files are unchanged. The first upload contained the source snapshot only. This follow-up also archives the pre-existing compiled files under `release/existing-dist/` and a Windows x64 runtime candidate under `release/`. Application compilation, startup, MCP calls and tests were not performed.

The original MIT license and upstream attribution are preserved.

## Existing Windows runtime supplement

Download into a fresh folder. Keep all `release/DevSpace-Windows-x64-existing-20261030.zip.*` parts together with `Extract.cmd` and `Extract.ps1`, then open `Extract.cmd`. It joins and extracts the archive. Open `DevSpace-Windows-x64/Start-Local.cmd` to initialize a fresh package-local Owner password and start the local MCP server. No private auth state is shipped. The assembled package is a candidate; Windows startup and MCP behavior require separate authorization and acceptance work.

The archived `dist` files were built on **2026-08-11 19:46:56 Asia/Shanghai**. The latest source edits are at **21:35:30** that evening, so this package preserves the existing earlier build. It has not been rebuilt from the final source. The original public launchers are included unchanged; they use the original user-profile auth/runtime directory and manage associated processes. The new packaging-only local launcher keeps state under the extracted folder and does not manage other services.

Production dependencies were restored using the unchanged source `package-lock.json`, with `npm ci --omit=dev --ignore-scripts --os=win32 --cpu=x64`. npm lifecycle scripts were disabled. The complete package names, versions, tarball locations and integrity hashes remain in that lockfile. Linux versions and new application executables were not produced.

### Runtime provenance and environment adjustments

| Component | Version and provenance |
|---|---|
| Node.js and npm | Official Windows x64 Node 24.14.0 ZIP; Node executable SHA-256 `63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088` matches the VM; npm 11.9.0 is included |
| cloudflared | Official 2026.7.3 Windows AMD64 executable; SHA-256 `8635da433b6df8194746e88ed9d2589566c20e38bfc2a80e431a348b7c765841` matches the VM |
| fd | Official 10.3.0 Windows x64 executable; SHA-256 `fd3d4853da7a319a604e1cb03ede88cbf584edd12b89a0991871fb4d9cd3ba5b` matches the VM |
| Git and Bash | Official PortableGit 2.51.0, the same Git release family observed in the VM. The observed non-private `etc/gitconfig` settings are preserved by the assembly script. This portable distribution replaces the VM's machine-installed tree |
| ripgrep | Official Windows x64 ripgrep 14.1.1, bundled for the existing grep tool |
| Windows | Requires Windows 10/11 x64 and standard system command/PowerShell components; no registry, system PATH or service installation is performed by the new local launcher |

`Start-Local.cmd` adds bundled `.tools/bin`, Node, Git cmd/usr/bin/mingw64/bin and cloudflared to **its process PATH only**, selects package-local `DEVSPACE_STATE_DIR`, and sets `PI_OFFLINE=1`. The package-local `devspace.cmd` shim points to the archived local CLI, replacing the redundant globally installed 1.0.6 DevSpace command. Original launchers, source lockfiles, license and existing compiled files remain available.

For reproduction, use `scripts/assemble-existing-windows.py` with a fresh staging destination, cache directory and a 7-Zip executable (`--sevenzip`). This performs downloads, dependency restoration and file assembly, without compiling or launching DevSpace. Use `scripts/package-windows-snapshot.py` to archive that folder and create Git-friendly parts and extraction scripts. Exact official download URLs and archive SHA-256 values are pinned in the assembly script. License files are included with third-party components.

Excluded material is limited to private state/credentials, original Git history objects, the duplicate old global DevSpace dependency tree, installers and duplicate downloaded tool archives, npm/pnpm installation debris and the temporary MCP probe file. Useful restoration, packaging, launcher and environment commands are indexed in `.agents/skills/devspace/SKILL.md`.

The runtime archive is **272,281,542 bytes** in six parts. The joined ZIP SHA-256 is `5fda1a408886b77f56abf138628624611c800755e169ae47d7227a8555c01cfe`. Individual part hashes are in `release/SHA256SUMS`. The extraction script checks the joined archive checksum before expanding it; it does not start the application.
