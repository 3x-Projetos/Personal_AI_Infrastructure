# Installation Guide - PAI Multi-Device Sync

**Pack**: pai-multi-device-sync v1.0.0
**Installation Time**: 15-20 minutes
**Prerequisites**: git, Node.js or bun, GitHub account

---

## Pre-Installation Checklist

Before installing this pack, ensure:

- [ ] Git installed (`git --version`)
- [ ] Git configured (`git config --global user.name` and `user.email`)
- [ ] Node.js 18+ or bun installed (`node --version` or `bun --version`)
- [ ] GitHub account with SSH key configured
- [ ] PAI core installed and working
- [ ] Internet connection available

---

## Phase 1: OBSERVE (5 minutes)

### Step 1.1: Verify Git Configuration

```bash
# Check git installation
git --version
# Expected: git version 2.x or higher

# Check git config
git config --global --list
# Expected: user.name and user.email set
```

**If not configured**:
```bash
git config --global user.name "Your Name"
git config --global user.email "your@email.com"
```

### Step 1.2: Test GitHub SSH Access

```bash
# Test SSH connection
ssh -T git@github.com
# Expected: "Hi <username>! You've successfully authenticated..."
```

**If SSH key missing**:
```bash
# Generate SSH key
ssh-keygen -t ed25519 -C "your@email.com"
# Press Enter for defaults

# Display public key
cat ~/.ssh/id_ed25519.pub
# Copy output

# Add to GitHub:
# 1. Open: https://github.com/settings/keys
# 2. Click "New SSH key"
# 3. Paste public key
# 4. Save
```

### Step 1.3: Check Runtime Environment

```bash
# Option A: Node.js
node --version
npm --version
# Expected: Node 18+ and npm 9+

# Option B: bun (preferred for PAI)
bun --version
# Expected: bun 1.0+
```

**If bun not installed**:
```bash
# Install bun
curl -fsSL https://bun.sh/install | bash

# Verify
bun --version
```

### Step 1.4: Verify PAI Core

```bash
# Check PAI installation
pai --version
# Expected: PAI core version

# List installed packs
pai list
# Should show pai-core-install
```

---

## Phase 2: PLAN (2 minutes)

### Step 2.1: Decide Cloud Storage Strategy

**Option A: Private Repository** (Recommended for work)
- Contains PII-redacted memories only
- Requires GitHub account
- Free for private repos

**Option B: Self-Hosted Git** (Advanced)
- Full control over data
- Requires git server setup
- More complex configuration

**We'll use Option A (GitHub private repo) in this guide.**

### Step 2.2: Choose Device Name

Pick a unique name for this device:
- Format: `<type>-<location>` (e.g., `laptop-work`, `desktop-home`)
- Lowercase, no spaces
- Descriptive but concise

**Examples**:
- `laptop-work` - Work laptop
- `desktop-home` - Home desktop
- `vm-dev` - Development VM
- `laptop-personal` - Personal laptop

### Step 2.3: Determine PII Redaction Level

**Level 1: Marker-based Only**
- You manually mark PII: `[PII:EMAIL]...[/PII:EMAIL]`
- Fast, explicit control
- Recommended for most users

**Level 2: Automatic Pattern Detection**
- Hook scans for PII patterns before push
- Blocks push if PII detected
- More secure, but may have false positives

**We'll configure Level 1 + Level 2 (both layers).**

---

## Phase 3: EXECUTE (10 minutes)

### Step 3.1: Create Cloud Repository

**Via GitHub Web UI**:

1. Open: https://github.com/new

2. Fill in details:
   - **Repository name**: `pai-memory-private` (or your choice)
   - **Description**: "Private PAI memories - multi-device sync"
   - **Visibility**: ✅ Private
   - **Initialize**: ❌ Don't add README (we'll push from local)

3. Click "Create repository"

4. Copy SSH URL (e.g., `git@github.com:username/pai-memory-private.git`)

### Step 3.2: Install Pack Files

```bash
# Navigate to PAI installation directory
cd ~/Personal_AI_Infrastructure

# Copy pack to Packs directory
cp -r ~/PAI_Development/Packs/pai-multi-device-sync Packs/

# Verify structure
ls -la Packs/pai-multi-device-sync/
# Expected: PACK, README.md, INSTALL.md, VERIFY.md, Config/, Skills/, Hooks/
```

### Step 3.3: Initialize Cloud Memory Directory

```bash
# Create cloud memory directory
mkdir -p ~/.claude-memory-cloud

# Initialize git repository
cd ~/.claude-memory-cloud
git init
git branch -M main

# Add remote (replace with your SSH URL)
git remote add origin git@github.com:username/pai-memory-private.git

# Verify remote
git remote -v
# Expected: origin git@github.com:username/pai-memory-private.git
```

### Step 3.4: Create Initial Configuration Files

**File: ~/.claude-memory-cloud/.config.json**

```bash
cat > ~/.claude-memory-cloud/.config.json << 'EOF'
{
  "version": "1.0",
  "sync_enabled": true,
  "cloud_repo": "git@github.com:username/pai-memory-private.git",
  "device_name": "REPLACE_WITH_YOUR_DEVICE_NAME",
  "sync": {
    "on_session_start": true,
    "on_session_end": true,
    "auto_commit": true,
    "conflict_resolution": "latest-timestamp"
  },
  "privacy": {
    "redact_pii": true,
    "auto_redact": ["email", "phone", "address", "api_key"],
    "cloud_safe_only": true
  },
  "notes": "Cloud sync enabled on 2026-01-10. First device in multi-device setup."
}
EOF

# Edit to replace placeholders
nano ~/.claude-memory-cloud/.config.json
# Or: code ~/.claude-memory-cloud/.config.json
```

**File: ~/.claude-memory-cloud/.sync-config.json**

```bash
cat > ~/.claude-memory-cloud/.sync-config.json << 'EOF'
{
  "version": "1.0",
  "owner": "your-github-username",
  "created": "2026-01-10",
  "sync": {
    "conflict_resolution": "latest-timestamp",
    "auto_merge": true,
    "preserve_both_on_conflict": true
  },
  "privacy": {
    "redact_pii_by_default": true,
    "allowed_pii_markers": ["PII-OK"],
    "auto_generate_safe_versions": true
  },
  "devices": {
    "registered": [],
    "max_devices": 10
  }
}
EOF
```

**File: ~/.claude-memory-cloud/.gitignore**

```bash
cat > ~/.claude-memory-cloud/.gitignore << 'EOF'
# Temporary files
*.tmp
*.bak
*~
.DS_Store
Thumbs.db

# Session state (not finalized)
session-state.md
*.in-progress

# Local config overrides
.config.local.json

# Sync conflicts (resolved manually)
sync/conflicts/*.resolved

# OS-specific
.Trash-*
.nfs*

# Never commit these (security)
*.env
credentials.json
secrets.yaml
*.key
*.pem
*_private.md

# Keep .safe.md files (PII-redacted)
!*.safe.md
!*.quick.md
EOF
```

### Step 3.5: Create Directory Structure

```bash
cd ~/.claude-memory-cloud

# Create required directories
mkdir -p sync devices global/tasks global/learnings

# Create device registry
cat > sync/device-registry.json << 'EOF'
{
  "version": "1.0",
  "devices": {},
  "total_devices": 0,
  "last_updated": "2026-01-10T00:00:00Z"
}
EOF

# Create initial global memory file
cat > global-memory.md << 'EOF'
# PAI Global Memory

**Version**: 1.0.0
**Last Updated**: 2026-01-10
**Sync Status**: Enabled

---

## User Profile

[PII:NAME]Your Name[/PII:NAME]
**Primary Device**: REPLACE_WITH_DEVICE_NAME
**Language**: English
**Timezone**: Your/Timezone

---

## Active Projects

(Add your projects here)

---

## Collaboration Patterns

(Add your preferences here)

---

**Last Sync**: 2026-01-10
EOF
```

### Step 3.6: Install Hooks

**File: ~/.claude/settings.json** (add/merge hooks section)

```bash
# Backup existing settings
cp ~/.claude/settings.json ~/.claude/settings.json.backup

# Add hooks configuration (merge with existing JSON)
# Use your editor to add this to settings.json:
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "bun ~/Personal_AI_Infrastructure/Packs/pai-multi-device-sync/Hooks/SessionStart.ts"
      }
    ],
    "SessionEnd": [
      {
        "type": "command",
        "command": "bun ~/Personal_AI_Infrastructure/Packs/pai-multi-device-sync/Hooks/SessionEnd.ts"
      }
    ],
    "PrePush": [
      {
        "type": "command",
        "command": "bun ~/Personal_AI_Infrastructure/Packs/pai-multi-device-sync/Hooks/PrePush.ts"
      }
    ]
  }
}
```

### Step 3.7: Register This Device

```bash
# Run device registration (interactive)
bun ~/Personal_AI_Infrastructure/Packs/pai-multi-device-sync/Scripts/register-device.ts

# You'll be prompted for:
# - Device name (e.g., laptop-work)
# - Device type (laptop/desktop/vm/mobile)
# - Operating system (detected automatically)
# - Enabled providers (claude/lmstudio/gemini)

# This creates:
# - Entry in sync/device-registry.json
# - Device info file at devices/<name>/info.md
# - Updated .config.json with device name
```

### Step 3.8: Initial Commit and Push

```bash
cd ~/.claude-memory-cloud

# Stage all files
git add .

# Create initial commit
git commit -m "Initial commit: Multi-device sync setup

Device: REPLACE_WITH_DEVICE_NAME
Pack: pai-multi-device-sync v1.0.0
Date: 2026-01-10

🤖 Generated with Claude Code"

# Push to remote
git push -u origin main

# Verify
git log --oneline -1
# Expected: Shows your commit
```

---

## Phase 4: VERIFY (5 minutes)

### Step 4.1: Test SessionStart Hook

```bash
# Close and reopen Claude Code session
# Check output for:
# [SessionStart] Cloud pull complete
# [SessionStart] Loaded context from session-state.md

# Verify hook executed
ls ~/.claude-memory-cloud/.git/
# Expected: FETCH_HEAD exists (pull happened)
```

### Step 4.2: Test SessionEnd Hook

```bash
# Make a change to global-memory.md
echo "\n## Test Entry - $(date)" >> ~/.claude-memory-cloud/global-memory.md

# Close Claude Code session
# Check output for:
# [SessionEnd] Log written to ...
# [SessionEnd] Cloud sync complete

# Verify commit created
cd ~/.claude-memory-cloud
git log --oneline -1
# Expected: Auto-sync commit with timestamp
```

### Step 4.3: Test PII Redaction

```bash
# Add PII to global-memory.md
echo "[PII:EMAIL]test@example.com[/PII:EMAIL]" >> ~/.claude-memory-cloud/global-memory.md

# Close session (triggers SessionEnd)

# Check .safe.md file generated
cat ~/.claude-memory-cloud/global-memory.safe.md | grep "REDACTED"
# Expected: [REDACTED:EMAIL]

# Verify no PII in what was pushed
git show HEAD:global-memory.safe.md | grep -i "test@example.com"
# Expected: No match (PII redacted)
```

### Step 4.4: Test Multi-Device Sync (if 2+ devices available)

**On Device A**:
```bash
# Make change
echo "## Entry from Device A" >> ~/.claude-memory-cloud/global-memory.md

# Close session (pushes to cloud)
```

**On Device B**:
```bash
# Open session (pulls from cloud)
# Verify change appears
grep "Entry from Device A" ~/.claude-memory-cloud/global-memory.md
# Expected: Match found
```

### Step 4.5: Run Full Verification Suite

```bash
# Run all tests
bun ~/Personal_AI_Infrastructure/Packs/pai-multi-device-sync/Scripts/verify.ts

# Expected output:
# ✅ Single device tests (6/6 passed)
# ✅ PII protection tests (4/4 passed)
# ✅ Error handling tests (4/4 passed)
# ⏭️ Multi-device tests (skipped - requires 2+ devices)
# ⏭️ Conflict tests (skipped - requires conflicts)
#
# Overall: 14/14 applicable tests passed
```

---

## Post-Installation

### Optional: Import Framework Memories

If migrating from claude-memory-framework v2.2.0:

```bash
# Copy Framework memories to cloud repo
cp -r ~/.claude-memory-cloud-framework/* ~/.claude-memory-cloud/

# Commit
cd ~/.claude-memory-cloud
git add .
git commit -m "Import Framework v2.2.0 memories"
git push

# Keep Framework repo as read-only archive
mv ~/.claude-memory-cloud-framework ~/.claude-memory-cloud-framework-archive
```

### Optional: Configure Additional Devices

Repeat Phase 3 on each device, but:
- Skip Step 3.1 (repo already exists)
- In Step 3.3, use `git clone` instead of `git init`:
  ```bash
  git clone git@github.com:username/pai-memory-private.git ~/.claude-memory-cloud
  ```
- Complete Steps 3.4-3.8 as written

### Optional: Enable Observability

To monitor sync events in real-time:

```bash
# Install observability pack (if available)
pai install pai-observability

# View sync logs
tail -f ~/.claude-memory-cloud/sync/events.log

# View hook execution
tail -f ~/.claude/hooks.log
```

---

## Troubleshooting

### Hooks not executing

**Check settings.json**:
```bash
cat ~/.claude/settings.json | jq '.hooks'
# Should show SessionStart, SessionEnd, PrePush entries
```

**Check hook permissions**:
```bash
chmod +x ~/Personal_AI_Infrastructure/Packs/pai-multi-device-sync/Hooks/*.ts
```

### Git push fails (authentication)

**Test SSH**:
```bash
ssh -T git@github.com
# Should show: "Hi username! You've successfully authenticated"
```

**Check remote URL**:
```bash
cd ~/.claude-memory-cloud
git remote -v
# Should use git@github.com (SSH), not https://
```

### PII not being redacted

**Check .config.json**:
```bash
cat ~/.claude-memory-cloud/.config.json | jq '.privacy.redact_pii'
# Should be: true
```

**Test redaction script manually**:
```bash
bun ~/Personal_AI_Infrastructure/Packs/pai-multi-device-sync/Scripts/redact-pii.ts
```

### Conflicts not auto-resolving

**Check conflict resolution setting**:
```bash
cat ~/.claude-memory-cloud/.sync-config.json | jq '.sync.conflict_resolution'
# Should be: "latest-timestamp"
```

**Manually resolve conflict**:
```bash
# Edit file, remove markers: <<<<<<<, =======, >>>>>>>
nano ~/.claude-memory-cloud/global-memory.md

# Commit resolution
git add global-memory.md
git commit -m "Resolve conflict manually"
git push
```

---

## Rollback

If installation fails or you want to uninstall:

```bash
# 1. Remove hooks from settings.json
jq 'del(.hooks.SessionStart, .hooks.SessionEnd, .hooks.PrePush)' \
  ~/.claude/settings.json > ~/.claude/settings.json.tmp
mv ~/.claude/settings.json.tmp ~/.claude/settings.json

# 2. Archive cloud directory (don't delete - has your memories!)
mv ~/.claude-memory-cloud ~/.claude-memory-cloud-backup-$(date +%Y%m%d)

# 3. Remove pack
rm -rf ~/Personal_AI_Infrastructure/Packs/pai-multi-device-sync

# 4. Restart Claude Code
```

---

## Next Steps

After successful installation:

1. **Test thoroughly**: Run VERIFY.md test suite
2. **Add second device**: Clone repo, register device, test sync
3. **Configure PII markers**: Review global-memory.md, mark sensitive data
4. **Install Pack 2**: pai-multi-provider (local models + Claude)
5. **Read docs**: See PAI_PACK_1_TECHNICAL_SPEC.md for advanced config

---

**Installation Complete!** 🎉

Your PAI memories now sync automatically across devices with PII protection.

**Support**:
- Documentation: PAI_PACK_1_TECHNICAL_SPEC.md
- Verification: VERIFY.md
- Issues: GitHub.com/danielmiessler/Personal_AI_Infrastructure/issues

---

**Version**: 1.0.0
**Last Updated**: 2026-01-10
**Author**: Luis Romano
