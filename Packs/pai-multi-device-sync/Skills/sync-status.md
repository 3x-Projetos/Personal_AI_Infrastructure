---
name: sync-status
description: Check multi-device sync status and registered devices
version: 1.0.0
pack: pai-multi-device-sync
---

# Sync Status Skill

Check the status of multi-device synchronization, registered devices, and pending operations.

## When to Use

Use this skill when:
- Checking if sync is working correctly
- Viewing all registered devices
- Investigating sync issues
- Monitoring pending pushes or conflicts

## What This Skill Shows

### 1. Registered Devices
- Total device count
- Device names, types, and OS
- Last seen timestamps
- Active providers per device

### 2. Sync Configuration
- Cloud repository URL
- Auto-sync enabled/disabled
- Conflict resolution strategy
- PII redaction settings

### 3. Sync Status
- Last pull timestamp
- Last push timestamp
- Pending pushes (queued for retry)
- Conflicts needing resolution

### 4. Network Status
- Cloud repository connectivity
- SSH/HTTPS authentication status
- Network availability

## Usage

```bash
# Run sync status check
bun ~/Personal_AI_Infrastructure/Packs/pai-multi-device-sync/Scripts/sync-status.ts
```

Or via PAI skill system (once integrated):
```
@sync-status
```

## Sample Output

```
╔════════════════════════════════════════════╗
║     PAI Multi-Device Sync - Status        ║
╚════════════════════════════════════════════╝

📱 Registered Devices: 2

  ✅ laptop-work (laptop, windows)
     Last seen: 2026-01-10 14:30:22 (2 minutes ago)
     Providers: claude
     Status: active

  ✅ desktop-home (desktop, linux)
     Last seen: 2026-01-09 18:45:10 (20 hours ago)
     Providers: claude, lmstudio
     Status: active

───────────────────────────────────────────

⚙️  Configuration

  Cloud repo: git@github.com:username/pai-memory-private.git
  Auto-sync: ✅ Enabled
  Conflict resolution: latest-timestamp
  PII redaction: ✅ Enabled

───────────────────────────────────────────

🔄 Sync Status

  Last pull: 2 minutes ago (SessionStart)
  Last push: 15 minutes ago (SessionEnd)
  Pending pushes: 0
  Conflicts: 0

───────────────────────────────────────────

🌐 Network Status

  Cloud connectivity: ✅ Online
  Authentication: ✅ Valid
  Last successful sync: 2 minutes ago

───────────────────────────────────────────

✅ All systems operational
```

## Status Indicators

### Device Status
- ✅ **active** - Device is active and syncing
- ⚠️  **stale** - No activity for >7 days
- ❌ **inactive** - Manually marked as inactive

### Sync Status
- ✅ **synced** - All changes pushed to cloud
- ⚠️  **pending** - Changes queued for push
- ❌ **conflict** - Merge conflicts need resolution

### Network Status
- ✅ **online** - Cloud repository accessible
- ⚠️  **degraded** - Slow or intermittent connectivity
- ❌ **offline** - No network or authentication failed

## Detailed Information

### Pending Pushes

If pushes are queued for retry:

```
⚠️  Pending Pushes: 2

  1. Commit abc123 (retry 1/3)
     Timestamp: 2026-01-10 12:00:00
     Error: Network timeout
     Next retry: On next SessionStart

  2. Commit def456 (retry 2/3)
     Timestamp: 2026-01-10 11:45:00
     Error: Connection refused
     Next retry: On next SessionStart
```

**Action**:
- Check network connection
- Verify cloud repository URL
- Check SSH credentials
- Wait for automatic retry (max 3 attempts)

### Conflicts

If merge conflicts detected:

```
❌ Conflicts: 1

  File: global-memory.md
  Type: Content conflict
  Devices: laptop-work vs desktop-home
  Resolution: Requires manual review or run resolve-conflicts.ts

  Action:
    1. Review conflicted file
    2. Run: bun Scripts/resolve-conflicts.ts
    3. Or manually edit and resolve
```

**Action**:
- Run automatic conflict resolution: `bun Scripts/resolve-conflicts.ts`
- Or manually edit files to remove `<<<<<<<`, `=======`, `>>>>>>>` markers
- Then: `git add <file> && git commit`

### Stale Devices

If devices haven't synced recently:

```
⚠️  Stale Devices: 1

  desktop-home (last seen 8 days ago)
    Suggestion: Check if device is still active
    Action: Update status to 'inactive' if no longer used
```

## Checking Specific Items

### View Device Registry
```bash
cat ~/.claude-memory-cloud/sync/device-registry.json | jq .
```

### View Pending Pushes
```bash
cat ~/.claude-memory-cloud/sync/pending-pushes.json | jq .
```

### View Conflicts
```bash
cd ~/.claude-memory-cloud
git diff --name-only --diff-filter=U
```

### View Last Sync Time
```bash
git log -1 --format="%ci"
```

### Test Cloud Connection
```bash
git ls-remote $(cat ~/.claude-memory-cloud/.config.json | jq -r '.cloud_repo')
```

## Troubleshooting

### Sync Status Shows "Offline"

**Possible causes**:
1. No internet connection
2. SSH key not configured
3. Cloud repository URL incorrect
4. Cloud repository access revoked

**Fix**:
```bash
# Test SSH
ssh -T git@github.com

# Test repository access
cd ~/.claude-memory-cloud
git fetch

# Check repository URL
git remote -v
```

### Pending Pushes Not Clearing

**Possible causes**:
1. Network still down
2. Max retries (3) exceeded
3. Authentication failed

**Fix**:
```bash
# Manual push
cd ~/.claude-memory-cloud
git push

# If authentication failed, reconfigure SSH
ssh-keygen -t ed25519
cat ~/.ssh/id_ed25519.pub
# Add to GitHub
```

### Devices Not Updating `last_seen`

**Possible causes**:
1. SessionStart hook not running
2. Device registry file locked
3. Git pull failed

**Fix**:
```bash
# Check hooks configured
cat ~/.claude/settings.json | jq '.hooks'

# Verify device registry
cat ~/.claude-memory-cloud/sync/device-registry.json | jq '.devices'

# Manual update (if needed)
# Edit device-registry.json and update last_seen timestamp
```

## Verification

After running sync-status, verify:

```bash
# All devices accounted for
cat ~/.claude-memory-cloud/sync/device-registry.json | jq '.total_devices'
# Should match number of devices you have

# No pending pushes (if online)
cat ~/.claude-memory-cloud/sync/pending-pushes.json | jq 'length'
# Should be 0 if network is available

# No conflicts
cd ~/.claude-memory-cloud
git status
# Should show "working tree clean"
```

## Related

- **Skills/device-register.md** - Register new devices
- **Scripts/resolve-conflicts.ts** - Automatic conflict resolution
- **VERIFY.md** - Test cases for sync verification

---

**Version**: 1.0.0
**Pack**: pai-multi-device-sync
**Script**: Scripts/sync-status.ts (to be created)
