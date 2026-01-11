---
name: device-register
description: Register a new device for multi-device sync
version: 1.0.0
pack: pai-multi-device-sync
---

# Device Registration Skill

Register this device in the PAI multi-device sync system.

## When to Use

Use this skill when:
- Setting up PAI on a new device
- Re-registering a device after reinstallation
- Updating device information

## Prerequisites

- PAI Multi-Device Sync pack installed
- Git configured (`git config user.name` and `user.email`)
- Cloud repository created (or will be created)

## What This Skill Does

1. **Prompts for device information**:
   - Device name (e.g., `laptop-work`, `desktop-home`)
   - Device type (laptop/desktop/vm/mobile)
   - Operating system (auto-detected)
   - Enabled providers (Claude/LMStudio/Gemini)

2. **Updates device registry**:
   - Adds entry to `sync/device-registry.json`
   - Creates device info file at `devices/<name>/info.md`

3. **Updates configuration**:
   - Sets `device_name` in `.config.json`
   - Preserves existing settings

4. **Tests connectivity**:
   - Validates cloud repository access
   - Checks SSH/HTTPS credentials

## Usage

```bash
# Interactive registration
bun ~/Personal_AI_Infrastructure/Packs/pai-multi-device-sync/Scripts/register-device.ts
```

Or via PAI skill system (once integrated):
```
@device-register
```

## Device Naming Convention

**Format**: `<type>-<location>`

**Examples**:
- `laptop-work` - Work laptop
- `desktop-home` - Home desktop
- `vm-dev` - Development VM
- `laptop-personal` - Personal laptop

**Rules**:
- Lowercase letters, numbers, and hyphens only
- Maximum 50 characters
- Descriptive but concise

## Device Types

1. **laptop** - Portable computer
2. **desktop** - Stationary computer
3. **vm** - Virtual machine
4. **mobile** - Mobile device (future support)

## Providers

Select which AI providers are available on this device:

1. **claude** - Claude CLI (always available)
2. **lmstudio** - Local models via LM Studio
3. **gemini** - Google Gemini (work laptop only)

## Output

After successful registration:

```
✅ Device registered in registry: laptop-work
✅ Device info created: devices/laptop-work/info.md
✅ Config updated with device name: laptop-work
✅ Cloud connection successful
```

## Files Created/Modified

1. **sync/device-registry.json**:
   ```json
   {
     "devices": {
       "laptop-work": {
         "type": "laptop",
         "os": "windows",
         "first_seen": "2026-01-10T12:00:00Z",
         "last_seen": "2026-01-10T12:00:00Z",
         "providers": ["claude"],
         "status": "active"
       }
     },
     "total_devices": 1
   }
   ```

2. **devices/laptop-work/info.md**:
   - Hardware details
   - Software installed
   - Active providers
   - Projects
   - Notes

3. **.config.json**:
   - `device_name` field updated

## Verification

After registration, verify with:

```bash
# Check registry
cat ~/.claude-memory-cloud/sync/device-registry.json | jq '.devices'

# Check device info
cat ~/.claude-memory-cloud/devices/<your-device-name>/info.md

# Check config
cat ~/.claude-memory-cloud/.config.json | jq '.device_name'
```

## Re-registration

If you need to re-register:
1. The script will detect existing registration
2. Prompt: "Device already exists. Overwrite? (yes/no)"
3. Choose `yes` to update information
4. `first_seen` timestamp is preserved
5. `last_seen` is updated

## Troubleshooting

**Error: Memory directory not found**
```
Run installation first:
See INSTALL.md Phase 3 (Repository Setup)
```

**Error: Cloud connection failed**
```
Check SSH key or credentials:
  ssh -T git@github.com
  # Should show: "Hi username! You've successfully authenticated"

If SSH key missing:
  ssh-keygen -t ed25519
  cat ~/.ssh/id_ed25519.pub
  # Add to GitHub: Settings → SSH Keys
```

**Error: Invalid device name**
```
Device name must be:
  - Lowercase only
  - Letters, numbers, hyphens
  - No spaces
  - Max 50 characters
```

## Multi-Device Workflow

**Device 1 (First device)**:
```bash
# 1. Register
bun register-device.ts
# Enter: laptop-work, laptop, claude

# 2. Commit and push
cd ~/.claude-memory-cloud
git add .
git commit -m "Register laptop-work device"
git push
```

**Device 2 (Additional device)**:
```bash
# 1. Clone repository
git clone git@github.com:username/pai-memory-private.git ~/.claude-memory-cloud

# 2. Register this device
bun register-device.ts
# Enter: desktop-home, desktop, claude,lmstudio

# 3. Push changes
# (SessionEnd hook will auto-push)
```

**Result**: Both devices now in registry, visible to each other

## Next Steps

After registration:

1. **Update device info**: Edit `devices/<name>/info.md` with your details
2. **Test sync**: Close/reopen Claude Code session
3. **Verify hooks**: Check logs for SessionStart/SessionEnd
4. **Add second device**: Clone repo, register, test bidirectional sync

## Related

- **Skills/sync-status.md** - Check sync status and registered devices
- **INSTALL.md Phase 3.7** - Device registration during installation
- **VERIFY.md Test 1.4** - Device registration test cases

---

**Version**: 1.0.0
**Pack**: pai-multi-device-sync
**Script**: Scripts/register-device.ts
