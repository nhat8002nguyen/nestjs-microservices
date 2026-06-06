# Disk Cleanup Tasks — ✅ Complete

1. **Phase 1 — Gather data (read-only measurements)** ✅
   - [x] **Disk:** 228GB total, **6.2GB free** (66% used)
   - [x] **Docker.raw** = 21G actual (60G max) at `~/Library/Containers/com.docker.docker/Data/vms/0/data/`
   - [x] **Brew:** 99 formulae, biggest: llvm 1.7G, boost 385M, JDK trio 795M, node 156M
   - [x] **~/Library totals:** Application Support 29G | Containers 24G | Caches 15G | Android SDK 7.9G | Developer 3.7G | pnpm 2.5G
   - [x] **Big caches:** Google 3.7G, Yarn 3.1G, pip 1.7G, Coursier 1.7G, TypeScript 934M
   - [x] **node_modules:** ~2.2G spread across projects (biggest: 512M photo-upload-app)

2. **Phase 2 — Docker full wipe (keep app, clear all data)** ✅
   - [x] Started Docker, stopped all 14 containers
   - [x] `docker system prune -a --volumes -f` — **reclaimed 13.25GB**
   - [x] Removed 15 orphaned Docker volumes
   - [x] Docker.raw shrunk from 21G → 2.0G (auto-compacted on APFS)
   - [x] **Reclaimed: ~19GB** from Docker

3. **Phase 3 — Homebrew cleanup (safe)** ✅
   - [x] `brew cleanup --prune=all` — cache went 323M → 59M
   - [x] `brew autoremove` — no orphaned deps found

4. **Phase 4 — Deep scan & user-space cleanup** ✅ (partial — macOS TCC blocked some)
   - [x] **Deleted successfully via Cursor terminal:**
     - Yarn cache (3.1G)
     - pip cache (1.7G)
     - Coursier cache (1.7G)
     - TypeScript cache (934M)
     - Lens updater cache (964M)
     - CocoaPods cache (445M)
     - Go build cache (313M)
     - Google browser cache (3.7G)
     - virtual-facility node_modules (259M)
   - [x] **Blocked by macOS TCC sandbox — see `cleanup-remaining.sh`:**
     - Android SDK (7.9G)
     - iOS CoreSimulator (3.7G)
     - Google Chrome profile (9.2G)
     - ZaloData (2.2G)
     - superwhisper (1.5G)
     - adspower_global (1.3G)
     - Lens app support (840M)
     - pnpm store (2.5G)
     - node_modules in Workspaces (~2G)
   - [x] Run `bash cleanup-remaining.sh` from a **regular Terminal** (not Cursor/VS Code)

5. **Phase 5 — Wrap up & report** ✅
   - [x] **Final: 6.2G free → 39Gi free (reclaimed ~33GB)**
   - [x] Remaining available cleanup if script is run: ~30G more
