#!/usr/bin/env bun
/**
 * Device Registration Script - PAI Multi-Device Sync
 *
 * Interactive device registration:
 * - Prompts for device name, type, OS
 * - Updates device-registry.json
 * - Creates device info file
 * - Updates .config.json
 *
 * @version 1.0.0
 * @author Luis Romano
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir, platform, arch } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

// Configuration
const MEMORY_DIR = join(homedir(), '.claude-memory-cloud');
const CONFIG_FILE = join(MEMORY_DIR, '.config.json');
const REGISTRY_FILE = join(MEMORY_DIR, 'sync', 'device-registry.json');
const DEVICES_DIR = join(MEMORY_DIR, 'devices');

// Logging helper
function log(message: string, level: 'info' | 'success' | 'error' = 'info') {
  const prefix = level === 'error' ? '❌' :
                 level === 'success' ? '✅' :
                 'ℹ️';
  console.log(`${prefix} ${message}`);
}

// Prompt for user input
function prompt(question: string): string {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    readline.question(question, (answer: string) => {
      readline.close();
      resolve(answer.trim());
    });
  });
}

// Detect OS
function detectOS(): string {
  const p = platform();
  if (p === 'win32') return 'windows';
  if (p === 'darwin') return 'macos';
  if (p === 'linux') return 'linux';
  return 'unknown';
}

// Validate device name
function validateDeviceName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Device name cannot be empty' };
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    return { valid: false, error: 'Device name must be lowercase letters, numbers, and hyphens only' };
  }

  if (name.length > 50) {
    return { valid: false, error: 'Device name must be 50 characters or less' };
  }

  return { valid: true };
}

// Load or create device registry
function loadRegistry(): any {
  if (!existsSync(REGISTRY_FILE)) {
    return {
      version: '1.0',
      devices: {},
      total_devices: 0,
      last_updated: new Date().toISOString()
    };
  }

  try {
    const content = readFileSync(REGISTRY_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    log(`Failed to load registry: ${error}`, 'error');
    process.exit(1);
  }
}

// Save device registry
function saveRegistry(registry: any): void {
  const syncDir = join(MEMORY_DIR, 'sync');
  if (!existsSync(syncDir)) {
    mkdirSync(syncDir, { recursive: true });
  }

  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

// Load config
function loadConfig(): any {
  if (!existsSync(CONFIG_FILE)) {
    log('Config file not found - will create', 'info');
    return null;
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    log(`Failed to load config: ${error}`, 'error');
    return null;
  }
}

// Save config
function saveConfig(config: any): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Create device info file
function createDeviceInfo(deviceName: string, deviceType: string, os: string, providers: string[]): void {
  const deviceDir = join(DEVICES_DIR, deviceName);
  if (!existsSync(deviceDir)) {
    mkdirSync(deviceDir, { recursive: true });
  }

  const now = new Date().toISOString().split('T')[0];
  const architecture = arch();

  const infoContent = `# Device: ${deviceName}

**Type**: ${deviceType.charAt(0).toUpperCase() + deviceType.slice(1)}
**OS**: ${os.charAt(0).toUpperCase() + os.slice(1)}
**Architecture**: ${architecture}
**First Seen**: ${now}
**Primary Use**: (Add your use case here)

---

## Hardware
**Specs**: (Add hardware details)
**Storage**: (SSD/HDD, capacity)
**Network**: (Network info)

---

## Software
**Git**: ${hasGit() ? '✅ Configured' : '❌ Not configured'}
**Node.js**: ${hasNodeJS() ? '✅ Installed' : '❌ Not installed'}
**Bun**: ${hasBun() ? '✅ Installed' : '❌ Not installed'}
**Python**: ${hasPython() ? '✅ Installed' : '❌ Not installed'}

---

## Providers
**Active**:
${providers.map(p => `- ${p}`).join('\n')}

**Available**:
- Claude CLI
- LMStudio (local models)
- Gemini (if on work laptop)

---

## Projects
**Primary**:
(List your main projects here)

---

## Notes
Device registered on ${now}.

**Last Updated**: ${now}
`;

  const infoFile = join(deviceDir, 'info.md');
  writeFileSync(infoFile, infoContent);
  log(`Device info created: ${infoFile}`, 'success');
}

// Check if commands are available
function hasGit(): boolean {
  try {
    execSync('git --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function hasNodeJS(): boolean {
  try {
    execSync('node --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function hasBun(): boolean {
  try {
    execSync('bun --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function hasPython(): boolean {
  try {
    execSync('python --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Test cloud connectivity
function testCloudConnection(cloudRepo: string): boolean {
  try {
    log('Testing cloud connectivity...', 'info');

    // Extract host from git URL
    const match = cloudRepo.match(/github\.com|gitlab\.com|bitbucket\.org/);
    if (!match) {
      log('Could not detect git provider from URL', 'error');
      return false;
    }

    // Test git ls-remote
    execSync(`git ls-remote ${cloudRepo}`, {
      timeout: 10000,
      stdio: 'pipe'
    });

    log('Cloud connection successful', 'success');
    return true;

  } catch (error) {
    log('Cloud connection failed - check SSH key or credentials', 'error');
    return false;
  }
}

// Main registration flow
async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║  PAI Multi-Device Sync - Device Registration  ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Check if memory directory exists
  if (!existsSync(MEMORY_DIR)) {
    log('Memory directory not found. Run installation first.', 'error');
    log(`Expected: ${MEMORY_DIR}`, 'info');
    process.exit(1);
  }

  // Load existing registry
  const registry = loadRegistry();

  // Show existing devices
  if (Object.keys(registry.devices).length > 0) {
    console.log('📱 Registered devices:');
    for (const [name, info] of Object.entries(registry.devices)) {
      console.log(`   - ${name} (${info.type}, ${info.os})`);
    }
    console.log('');
  }

  // Prompt for device name
  console.log('Device name format: <type>-<location>');
  console.log('Examples: laptop-work, desktop-home, vm-dev\n');

  let deviceName = '';
  while (true) {
    deviceName = await prompt('Device name: ');
    const validation = validateDeviceName(deviceName);

    if (!validation.valid) {
      log(validation.error!, 'error');
      continue;
    }

    // Check if already registered
    if (registry.devices[deviceName]) {
      const overwrite = await prompt(`Device "${deviceName}" already exists. Overwrite? (yes/no): `);
      if (overwrite.toLowerCase() !== 'yes') {
        continue;
      }
    }

    break;
  }

  // Prompt for device type
  console.log('\nDevice types:');
  console.log('  1) laptop');
  console.log('  2) desktop');
  console.log('  3) vm (virtual machine)');
  console.log('  4) mobile\n');

  const typeChoice = await prompt('Choose type (1-4): ');
  const types = ['laptop', 'desktop', 'vm', 'mobile'];
  const deviceType = types[parseInt(typeChoice) - 1] || 'desktop';

  // Detect OS
  const os = detectOS();
  log(`Detected OS: ${os}`, 'info');

  // Prompt for providers
  console.log('\nAvailable providers:');
  console.log('  1) claude (Claude CLI)');
  console.log('  2) lmstudio (Local models)');
  console.log('  3) gemini (Work laptop only)\n');

  const providerInput = await prompt('Select providers (comma-separated, e.g., 1,2): ');
  const providerChoices = providerInput.split(',').map(s => parseInt(s.trim()));
  const allProviders = ['claude', 'lmstudio', 'gemini'];
  const providers = providerChoices.map(i => allProviders[i - 1]).filter(Boolean);

  if (providers.length === 0) {
    providers.push('claude'); // Default to Claude
  }

  console.log('');

  // Register device in registry
  const now = new Date().toISOString();
  registry.devices[deviceName] = {
    type: deviceType,
    os: os,
    first_seen: registry.devices[deviceName]?.first_seen || now,
    last_seen: now,
    providers: providers,
    status: 'active'
  };
  registry.total_devices = Object.keys(registry.devices).length;
  registry.last_updated = now;

  saveRegistry(registry);
  log(`Device registered in registry: ${deviceName}`, 'success');

  // Create device info file
  createDeviceInfo(deviceName, deviceType, os, providers);

  // Update .config.json
  let config = loadConfig();
  if (!config) {
    // Create default config
    config = {
      version: '1.0',
      sync_enabled: true,
      cloud_repo: 'git@github.com:username/pai-memory-private.git',
      device_name: deviceName,
      sync: {
        on_session_start: true,
        on_session_end: true,
        auto_commit: true,
        conflict_resolution: 'latest-timestamp'
      },
      privacy: {
        redact_pii: true,
        auto_redact: ['email', 'phone', 'address', 'api_key'],
        cloud_safe_only: true
      },
      notes: `Cloud sync enabled on ${now.split('T')[0]}. Device registered via registration script.`
    };
  } else {
    config.device_name = deviceName;
  }

  saveConfig(config);
  log(`Config updated with device name: ${deviceName}`, 'success');

  // Test cloud connection
  console.log('');
  if (config.cloud_repo && !config.cloud_repo.includes('username')) {
    testCloudConnection(config.cloud_repo);
  } else {
    log('Cloud repo not configured yet - update .config.json', 'info');
    log(`File: ${CONFIG_FILE}`, 'info');
  }

  // Summary
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║          Registration Complete!            ║');
  console.log('╚════════════════════════════════════════════╝\n');
  console.log(`Device: ${deviceName}`);
  console.log(`Type: ${deviceType}`);
  console.log(`OS: ${os}`);
  console.log(`Providers: ${providers.join(', ')}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Update cloud_repo in .config.json (if not done)');
  console.log('  2. Run initial sync: cd ~/.claude-memory-cloud && git push');
  console.log('  3. Test sync: bun verify.ts --category single-device');
  console.log('');
}

// Execute
main().catch((error) => {
  log(`Registration failed: ${error}`, 'error');
  process.exit(1);
});
