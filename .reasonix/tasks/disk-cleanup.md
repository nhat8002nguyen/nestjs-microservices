# Disk Cleanup Task List

## 1. Assess current disk usage
- [ ] Run df -h to see filesystem usage
- [ ] Run docker system df to see Docker footprint
- [ ] Check Homebrew and other package sizes

## 2. Prune Docker safely (conservative)
- [ ] Stop running containers with docker compose down
- [ ] Prune stopped containers and unused images
- [ ] Prune build cache (BuildKit)
- [ ] Summarize reclaimed Docker space

## 3. Clean node_modules, dist, and yarn caches
- [ ] Remove node_modules/ directory
- [ ] Remove dist/ directory
- [ ] Clear yarn cache
- [ ] Check for other stale node_modules

## 4. Clean macOS system data (safe)
- [ ] Clear user and system caches
- [ ] Clear system logs
- [ ] Clean Time Machine local snapshots
- [ ] Check Xcode derived data and iOS backups

## 5. Clean Homebrew and remaining package managers
- [ ] Run brew cleanup --prune=all
- [ ] Run brew autoremove
- [ ] Report final space reclaimed
