#!/usr/bin/env bun
/**
 * SessionStart Hook - PAI Multi-Device Sync
 *
 * Automatically pulls latest changes from cloud on session start.
 * Implements offline-first strategy with graceful degradation.
 *
 * Based on Framework v2.2.0 patterns, adapted for PAI hooks.
 *
 * @version 1.0.0
 * @author Luis Romano
 */

import { readFileSync, existsSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

// Configuration
const MEMORY_DIR = join(homedir(), '.claude-memory-cloud');
const CONFIG_FILE = join(MEMORY_DIR, '.config.json');
const PENDING_PUSHES_FILE = join(MEMORY_DIR, 'sync', 'pending-pushes.json');
const DEVICE_REGISTRY_FILE = join(MEMORY_DIR, 'sync', 'device-registry.json');

interface Config {
  version: string;
  sync_enabled: boolean;
  cloud_repo: string;
  device_name: string;
  sync: {
    on_session_start: boolean;
    on_session_end: boolean;
    auto_commit: boolean;
    conflict_resolution: string;
  };
  privacy: {
    redact_pii: boolean;
    auto_redact: string[];
    cloud_safe_only: boolean;
  };
}

interface PendingPush {
  timestamp: string;
  commit_hash: string;
  retry_count: number;
  error?: string;
  last_retry?: string;
}

// Logging helper
function log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  const prefix = level === 'error' ? '[❌ SessionStart]' :
                 level === 'warn' ? '[⚠️  SessionStart]' :
                 '[✅ SessionStart]';
  console.error(`${prefix} ${message}`);
}

// Load configuration
function loadConfig(): Config | null {
  try {
    if (!existsSync(CONFIG_FILE)) {
      log('No config found - sync disabled', 'warn');
      return null;
    }
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    log(`Failed to load config: ${error}`, 'error');
    return null;
  }
}

// Pull latest changes from cloud
async function pullFromCloud(): Promise<{ success: boolean; message: string }> {
  try {
    // Execute git pull with timeout
    const output = execSync('git pull --rebase --quiet', {
      cwd: MEMORY_DIR,
      encoding: 'utf-8',
      timeout: 10000,  // 10 seconds
      stdio: 'pipe'
    });

    // Check for conflicts
    const status = execSync('git status --short', {
      cwd: MEMORY_DIR,
      encoding: 'utf-8',
      timeout: 5000
    });

    if (status.includes('UU') || status.includes('AA')) {
      log('Merge conflicts detected - manual resolution required', 'warn');
      return {
        success: false,
        message: 'Conflicts detected - see git status'
      };
    }

    log('Cloud pull complete');
    return {
      success: true,
      message: 'Synced with cloud'
    };

  } catch (error: any) {
    // Handle specific errors
    if (error.code === 'ETIMEDOUT') {
      log('Network timeout - continuing offline', 'warn');
      return {
        success: true,  // Don't block session
        message: 'Offline mode - sync skipped'
      };
    }

    if (error.status === 128) {  // Git error
      log('Git error (network or auth) - continuing offline', 'warn');
      return {
        success: true,  // Don't block session
        message: 'Offline mode - git error'
      };
    }

    log(`Pull failed: ${error.message}`, 'error');
    return {
      success: true,  // Don't block session
      message: 'Offline mode - error during pull'
    };
  }
}

// Retry pending pushes from previous sessions
async function retryPendingPushes(): Promise<void> {
  try {
    if (!existsSync(PENDING_PUSHES_FILE)) {
      return;  // No pending pushes
    }

    const content = readFileSync(PENDING_PUSHES_FILE, 'utf-8');
    const pending: PendingPush[] = JSON.parse(content);

    if (pending.length === 0) {
      return;
    }

    log(`Found ${pending.length} pending push(es) - retrying...`, 'info');

    const stillPending: PendingPush[] = [];

    for (const push of pending) {
      if (push.retry_count >= 3) {
        log(`Max retries exceeded for ${push.commit_hash} - manual intervention required`, 'warn');
        stillPending.push(push);
        continue;
      }

      try {
        // Attempt push
        execSync('git push --quiet', {
          cwd: MEMORY_DIR,
          timeout: 30000,
          stdio: 'pipe'
        });

        log(`Pending push succeeded: ${push.commit_hash}`);
        // Don't add to stillPending (successfully pushed)

      } catch (error) {
        // Push failed - increment retry count
        push.retry_count++;
        push.last_retry = new Date().toISOString();
        push.error = error instanceof Error ? error.message : String(error);
        stillPending.push(push);

        log(`Retry ${push.retry_count}/3 failed for ${push.commit_hash}`, 'warn');
      }
    }

    // Update pending pushes file
    writeFileSync(PENDING_PUSHES_FILE, JSON.stringify(stillPending, null, 2));

  } catch (error) {
    log(`Error processing pending pushes: ${error}`, 'error');
  }
}

// Update device last_seen timestamp
async function updateDeviceRegistry(deviceName: string): Promise<void> {
  try {
    if (!existsSync(DEVICE_REGISTRY_FILE)) {
      log('Device registry not found - skipping update', 'warn');
      return;
    }

    const content = readFileSync(DEVICE_REGISTRY_FILE, 'utf-8');
    const registry = JSON.parse(content);

    if (!registry.devices[deviceName]) {
      log(`Device ${deviceName} not in registry - skipping update`, 'warn');
      return;
    }

    // Update last_seen timestamp
    registry.devices[deviceName].last_seen = new Date().toISOString();
    registry.last_updated = new Date().toISOString();

    writeFileSync(DEVICE_REGISTRY_FILE, JSON.stringify(registry, null, 2));

    log(`Updated last_seen for device: ${deviceName}`);

  } catch (error) {
    log(`Failed to update device registry: ${error}`, 'error');
  }
}

// Main execution
async function main() {
  try {
    // Read event from stdin (PAI hook format)
    const input = readFileSync(0, 'utf-8');
    const event = JSON.parse(input);

    log('SessionStart event received');

    // Load configuration
    const config = loadConfig();
    if (!config || !config.sync_enabled) {
      log('Sync disabled in config');
      process.exit(0);  // Success (no action needed)
    }

    if (!config.sync.on_session_start) {
      log('SessionStart sync disabled in config');
      process.exit(0);
    }

    // Check if directory exists
    if (!existsSync(MEMORY_DIR)) {
      log('Memory directory not found - run installation first', 'error');
      process.exit(0);  // Don't block session
    }

    // Execute sync operations
    log('Starting cloud sync...');

    // 1. Pull from cloud
    const pullResult = await pullFromCloud();
    if (!pullResult.success) {
      log(pullResult.message, 'warn');
    }

    // 2. Retry pending pushes (from offline sessions)
    await retryPendingPushes();

    // 3. Update device registry
    if (config.device_name) {
      await updateDeviceRegistry(config.device_name);
    }

    log('SessionStart complete');
    process.exit(0);  // Success

  } catch (error) {
    log(`Hook error: ${error}`, 'error');
    process.exit(0);  // Always exit 0 (never block Claude Code)
  }
}

// Execute
main();
