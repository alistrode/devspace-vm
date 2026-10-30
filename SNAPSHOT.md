# VMware DevSpace development snapshot

Source: `M:\devspace` in the VMware Windows 10 x64 guest, captured read-only on 2026-10-30.

This is the locally developed Owner-authenticated MCP version (`1.0.5`). Its latest core source changes are dated 2026-08-11 21:35:30 Asia/Shanghai. The separate `M:\devspace-main` directory contains upstream version `1.0.6` files dated 2026-08-08, predating these local changes.

The original checkout points to `Waishnav/devspace` commit `8cd2fba227454514f3ce8ef4848012753103e773`. This snapshot preserves the current working source, including local changes that were never committed in that checkout. It is archived in its own project branch.

All 33 source files were checked against SHA-256 hashes read from the virtual disk. Seventeen matching upstream files were retrieved directly from the pinned upstream commit; sixteen locally changed files were restored from the guest source snapshot. `SOURCE-MANIFEST.json` records every source path, size and hash.

The snapshot includes source, lockfiles, documentation, original assets and Windows launcher scripts. Installed dependencies, bundled Git/runtime tools, generated builds, original Git objects and a temporary MCP probe file are excluded. The original source files are unchanged. Application builds and runtime behavior were not validated as part of this archival upload.

The original MIT license and upstream attribution are preserved.
