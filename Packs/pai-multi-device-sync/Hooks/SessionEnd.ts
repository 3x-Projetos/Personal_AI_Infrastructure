#!/usr/bin/env bun
/**
 * SessionEnd Hook - PAI Multi-Device Sync
 *
 * Automatically commits and pushes changes to cloud on session end.
 * Implements PII redaction before push.
 *
 * Based on Framework v2.2.0 patterns, adapted for PAI hooks.
 *
 * @version 1.0.0
 * @author Luis Romano
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync, appendFileSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

// Configuration
const MEMORY_DIR = join(homedir(), '.claude-memory-cloud');
const CONFIG_FILE = join(MEMORY_DIR, '.config.json');
const PENDING_PUSHES_FILE = join(MEMORY_DIR, 'sync', 'pending-pushes.json');
const LOGS_DIR = join(homedir(), '.claude-memory', 'providers', 'claude', 'logs', 'daily');

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
}

// Logging helper
function log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  const prefix = level === 'error' ? '[❌ SessionEnd]' :
                 level === 'warn' ? '[⚠️  SessionEnd]' :
                 '[✅ SessionEnd]';
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

// Run PII redaction script
async function redactPII(): Promise<boolean> {
  try {
    const scriptPath = join(__dirname, '..', 'Scripts', 'redact-pii.ts');

    if (!existsSync(scriptPath)) {
      log('PII redaction script not found - skipping', 'warn');
      return true;  // Continue anyway
    }

    log('Running PII redaction...');

    execSync(`bun "${scriptPath}"`, {
      cwd: MEMORY_DIR,
      timeout: 30000,
      stdio: 'pipe'
    });

    log('PII redaction complete');
    return true;

  } catch (error) {
    log(`PII redaction failed: ${error}`, 'error');
    return false;  // Don't push if redaction fails
  }
}

// Create git commit
async function createCommit(deviceName: string): Promise<string | null> {
  try {
    // Check if there are changes to commit
    const status = execSync('git status --short', {
      cwd: MEMORY_DIR,
      encoding: 'utf-8',
      timeout: 5000
    });

    if (status.trim() === '') {
      log('No changes to commit');
      return null;
    }

    // Stage all changes
    execSync('git add .', {
      cwd: MEMORY_DIR,
      timeout: 5000,
      stdio: 'pipe'
    });

    // Create commit message
    const timestamp = new Date().toISOString().replace('T', '_').split('.')[0];
    const commitMessage = `Auto-sync: SessionEnd on ${deviceName}

Session closed at ${timestamp}
Changes synced automatically via PAI hook

🤖 Generated with Claude Code (https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>`;

    // Create commit
    execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
      cwd: MEMORY_DIR,
      timeout: 10000,
      stdio: 'pipe'
    });

    // Get commit hash
    const commitHash = execSync('git rev-parse HEAD', {
      cwd: MEMORY_DIR,
      encoding: 'utf-8',
      timeout: 5000
    }).trim();

    log(`Commit created: ${commitHash.slice(0, 7)}`);
    return commitHash;

  } catch (error: any) {
    // Check if error is "nothing to commit"
    if (error.stderr?.includes('nothing to commit')) {
      log('No changes to commit');
      return null;
    }

    log(`Failed to create commit: ${error.message}`, 'error');
    return null;
  }
}

// Push to cloud
async function pushToCloud(): Promise<{ success: boolean; error?: string }> {
  try {
    execSync('git push --quiet', {
      cwd: MEMORY_DIR,
      timeout: 30000,
      stdio: 'pipe'
    });

    log('Cloud push complete');
    return { success: true };

  } catch (error: any) {
    // Network or auth error - queue for retry
    log(`Push failed: ${error.message}`, 'warn');
    return {
      success: false,
      error: error.message
    };
  }
}

// Queue push for retry
async function queuePendingPush(commitHash: string, error: string): Promise<void> {
  try {
    const syncDir = join(MEMORY_DIR, 'sync');
    if (!existsSync(syncDir)) {
      mkdirSync(syncDir, { recursive: true });
    }

    let pending: PendingPush[] = [];
    if (existsSync(PENDING_PUSHES_FILE)) {
      const content = readFileSync(PENDING_PUSHES_FILE, 'utf-8');
      pending = JSON.parse(content);
    }

    // Add to queue
    pending.push({
      timestamp: new Date().toISOString(),
      commit_hash: commitHash,
      retry_count: 0,
      error: error
    });

    writeFileSync(PENDING_PUSHES_FILE, JSON.stringify(pending, null, 2));

    log(`Push queued for retry (commit: ${commitHash.slice(0, 7)})`);

  } catch (error) {
    log(`Failed to queue pending push: ${error}`, 'error');
  }
}

// Generate daily log entry
async function generateDailyLog(deviceName: string, event: any): Promise<void> {
  try {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '.');
    const logFile = join(LOGS_DIR, `${dateStr}.md`);

    // Ensure logs directory exists
    if (!existsSync(LOGS_DIR)) {
      mkdirSync(LOGS_DIR, { recursive: true });
    }

    // Create session entry
    const sessionEntry = `
## Session ${now.toLocaleTimeString()} (Auto-logged by SessionEnd hook)

**Device**: ${deviceName}
**Duration**: ${event.session_duration_minutes || 'Unknown'} minutes
**Context**: ${event.session_context || 'General work session'}

### Activities
- Session captured automatically via PAI hook
- Changes synced to cloud repository

### Metrics
- Events captured: ${event.events_count || 0}
- Tools used: ${event.tools_used?.join(', ') || 'Unknown'}

---
`;

    // Append to log file
    appendFileSync(logFile, sessionEntry);

    log(`Daily log updated: ${logFile}`);

  } catch (error) {
    log(`Failed to generate daily log: ${error}`, 'warn');
    // Don't fail on log errors
  }
}

// Main execution
async function main() {
  try {
    // Read event from stdin (PAI hook format)
    const input = readFileSync(0, 'utf-8');
    const event = JSON.parse(input);

    log('SessionEnd event received');

    // Load configuration
    const config = loadConfig();
    if (!config || !config.sync_enabled) {
      log('Sync disabled in config');
      process.exit(0);
    }

    if (!config.sync.on_session_end) {
      log('SessionEnd sync disabled in config');
      process.exit(0);
    }

    // Check if directory exists
    if (!existsSync(MEMORY_DIR)) {
      log('Memory directory not found - run installation first', 'error');
      process.exit(0);  // Don't block session end
    }

    log('Starting cloud sync...');

    // 1. Run PII redaction (if enabled)
    if (config.privacy.redact_pii) {
      const redactionSuccess = await redactPII();
      if (!redactionSuccess) {
        log('PII redaction failed - skipping push for safety', 'error');
        process.exit(0);  // Don't push if redaction fails
      }
    }

    // 2. Create git commit
    const commitHash = await createCommit(config.device_name);
    if (!commitHash) {
      log('No commit created (no changes or error)');
      process.exit(0);
    }

    // 3. Push to cloud
    const pushResult = await pushToCloud();
    if (!pushResult.success) {
      // Queue for retry
      await queuePendingPush(commitHash, pushResult.error || 'Unknown error');
    }

    // 4. Generate daily log entry
    await generateDailyLog(config.device_name, event);

    log('SessionEnd complete');
    process.exit(0);

  } catch (error) {
    log(`Hook error: ${error}`, 'error');
    process.exit(0);  // Always exit 0 (never block Claude Code)
  }
}

// Execute
main();
