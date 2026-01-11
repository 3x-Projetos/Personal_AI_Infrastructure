#!/usr/bin/env bun
/**
 * Conflict Resolution Script - PAI Multi-Device Sync
 *
 * Automatically resolves git merge conflicts using timestamp-based strategy.
 * Based on Framework v2.2.0 patterns.
 *
 * Strategy:
 * - Extract timestamps from both versions
 * - Keep version with latest timestamp
 * - Archive older version for audit
 * - Log resolution details
 *
 * @version 1.0.0
 * @author Luis Romano
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import { execSync } from 'child_process';

// Configuration
const MEMORY_DIR = join(homedir(), '.claude-memory-cloud');
const CONFLICTS_DIR = join(MEMORY_DIR, 'sync', 'conflicts');
const SYNC_CONFIG_FILE = join(MEMORY_DIR, '.sync-config.json');

// Critical files that require manual resolution
const MANUAL_RESOLUTION_FILES = [
  '.config.json',
  '.sync-config.json',
  'sync/device-registry.json'
];

interface ConflictMarkers {
  local: string;
  remote: string;
  localDevice?: string;
  remoteDevice?: string;
  localTimestamp?: Date;
  remoteTimestamp?: Date;
}

// Logging helper
function log(message: string, level: 'info' | 'success' | 'warn' | 'error' = 'info') {
  const prefix = level === 'error' ? '❌' :
                 level === 'warn' ? '⚠️ ' :
                 level === 'success' ? '✅' :
                 'ℹ️';
  console.log(`${prefix} ${message}`);
}

// Extract conflict markers from file content
function extractConflict(content: string): ConflictMarkers | null {
  const conflictPattern = /<<<<<<< HEAD\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> .*/;
  const match = content.match(conflictPattern);

  if (!match) {
    return null;
  }

  return {
    local: match[1],
    remote: match[2]
  };
}

// Extract timestamp from content (looks for ISO 8601 or common date formats)
function extractTimestamp(content: string): Date | null {
  // Try ISO 8601 format first
  const isoMatch = content.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  if (isoMatch) {
    return new Date(isoMatch[0]);
  }

  // Try common date formats
  const dateMatch = content.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/);
  if (dateMatch) {
    return new Date(dateMatch[0]);
  }

  // Try last_updated field (common in JSON)
  const lastUpdatedMatch = content.match(/"last_updated":\s*"([^"]+)"/);
  if (lastUpdatedMatch) {
    return new Date(lastUpdatedMatch[1]);
  }

  return null;
}

// Extract device name from content
function extractDevice(content: string): string {
  // Look for device_name field
  const deviceMatch = content.match(/"device_name":\s*"([^"]+)"/);
  if (deviceMatch) {
    return deviceMatch[1];
  }

  // Look for Device: header in markdown
  const mdDeviceMatch = content.match(/\*\*Device\*\*:\s*(\S+)/);
  if (mdDeviceMatch) {
    return mdDeviceMatch[1];
  }

  return 'unknown';
}

// Resolve conflict using timestamp-based strategy
function resolveByTimestamp(markers: ConflictMarkers): { winner: 'local' | 'remote'; reason: string } {
  const localTs = extractTimestamp(markers.local);
  const remoteTs = extractTimestamp(markers.remote);

  if (!localTs && !remoteTs) {
    return {
      winner: 'local',
      reason: 'No timestamps found - defaulting to local'
    };
  }

  if (!localTs) {
    return {
      winner: 'remote',
      reason: 'Only remote has timestamp'
    };
  }

  if (!remoteTs) {
    return {
      winner: 'local',
      reason: 'Only local has timestamp'
    };
  }

  if (remoteTs > localTs) {
    const diffMinutes = Math.round((remoteTs.getTime() - localTs.getTime()) / 60000);
    return {
      winner: 'remote',
      reason: `Remote is newer by ${diffMinutes} minute(s)`
    };
  } else {
    const diffMinutes = Math.round((localTs.getTime() - remoteTs.getTime()) / 60000);
    return {
      winner: 'local',
      reason: `Local is newer by ${diffMinutes} minute(s)`
    };
  }
}

// Archive losing version
function archiveLoserVersion(filePath: string, content: string, device: string, timestamp: Date | null): void {
  if (!existsSync(CONFLICTS_DIR)) {
    mkdirSync(CONFLICTS_DIR, { recursive: true });
  }

  const filename = basename(filePath);
  const tsStr = timestamp ? timestamp.toISOString().replace(/[:.]/g, '-') : new Date().toISOString().replace(/[:.]/g, '-');
  const archivePath = join(CONFLICTS_DIR, `${filename}.${device}.${tsStr}.archived`);

  writeFileSync(archivePath, content);
  log(`Archived to: ${archivePath}`, 'info');
}

// Create conflict resolution log entry
function logConflictResolution(
  filePath: string,
  winner: 'local' | 'remote',
  reason: string,
  localDevice: string,
  remoteDevice: string,
  localTimestamp: Date | null,
  remoteTimestamp: Date | null
): void {
  const logFile = join(CONFLICTS_DIR, 'resolution-log.md');

  if (!existsSync(CONFLICTS_DIR)) {
    mkdirSync(CONFLICTS_DIR, { recursive: true });
  }

  const logEntry = `
## Conflict Resolution - ${new Date().toISOString()}

**File**: ${filePath}
**Winner**: ${winner}
**Reason**: ${reason}

**Local Version**:
- Device: ${localDevice}
- Timestamp: ${localTimestamp?.toISOString() || 'Not found'}

**Remote Version**:
- Device: ${remoteDevice}
- Timestamp: ${remoteTimestamp?.toISOString() || 'Not found'}

**Action**: Kept ${winner} version, archived ${winner === 'local' ? 'remote' : 'local'} version

---
`;

  if (!existsSync(logFile)) {
    writeFileSync(logFile, `# Conflict Resolution Log\n\n`);
  }

  const existingContent = readFileSync(logFile, 'utf-8');
  writeFileSync(logFile, existingContent + logEntry);
}

// Check if file requires manual resolution
function requiresManualResolution(filePath: string): boolean {
  const relativePath = filePath.replace(MEMORY_DIR + '/', '');
  return MANUAL_RESOLUTION_FILES.some(pattern => relativePath.includes(pattern));
}

// Get list of conflicted files
function getConflictedFiles(): string[] {
  try {
    const output = execSync('git diff --name-only --diff-filter=U', {
      cwd: MEMORY_DIR,
      encoding: 'utf-8'
    });

    return output.split('\n').filter(Boolean).map(f => join(MEMORY_DIR, f));
  } catch (error) {
    log('Failed to get conflicted files', 'error');
    return [];
  }
}

// Resolve a single file
function resolveFile(filePath: string): boolean {
  try {
    log(`Processing: ${filePath}`, 'info');

    // Check if requires manual resolution
    if (requiresManualResolution(filePath)) {
      log('⚠️  This file requires manual resolution (critical config)', 'warn');
      log(`   Edit: ${filePath}`, 'info');
      log(`   Remove markers: <<<<<<< ======= >>>>>>>`, 'info');
      log(`   Then: git add ${filePath}`, 'info');
      return false;
    }

    // Read file content
    const content = readFileSync(filePath, 'utf-8');

    // Extract conflict markers
    const markers = extractConflict(content);
    if (!markers) {
      log('No conflict markers found', 'warn');
      return false;
    }

    // Extract metadata
    markers.localDevice = extractDevice(markers.local);
    markers.remoteDevice = extractDevice(markers.remote);
    markers.localTimestamp = extractTimestamp(markers.local);
    markers.remoteTimestamp = extractTimestamp(markers.remote);

    // Resolve using timestamp
    const resolution = resolveByTimestamp(markers);

    log(`Resolution: ${resolution.winner} wins (${resolution.reason})`, 'success');

    // Archive loser version
    const loserContent = resolution.winner === 'local' ? markers.remote : markers.local;
    const loserDevice = resolution.winner === 'local' ? markers.remoteDevice! : markers.localDevice!;
    const loserTimestamp = resolution.winner === 'local' ? markers.remoteTimestamp : markers.localTimestamp;

    archiveLoserVersion(filePath, loserContent, loserDevice, loserTimestamp);

    // Write winner version
    const winnerContent = resolution.winner === 'local' ? markers.local : markers.remote;
    writeFileSync(filePath, winnerContent);

    // Stage resolved file
    execSync(`git add "${filePath}"`, {
      cwd: MEMORY_DIR,
      stdio: 'pipe'
    });

    // Log resolution
    logConflictResolution(
      filePath,
      resolution.winner,
      resolution.reason,
      markers.localDevice!,
      markers.remoteDevice!,
      markers.localTimestamp,
      markers.remoteTimestamp
    );

    log(`✅ Resolved: ${filePath}`, 'success');
    return true;

  } catch (error) {
    log(`Failed to resolve ${filePath}: ${error}`, 'error');
    return false;
  }
}

// Main execution
function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║    PAI Multi-Device Sync - Conflict Resolution    ║');
  console.log('╚════════════════════════════════════════════╝\n');

  // Check if memory directory exists
  if (!existsSync(MEMORY_DIR)) {
    log('Memory directory not found', 'error');
    process.exit(1);
  }

  // Get conflicted files
  const conflictedFiles = getConflictedFiles();

  if (conflictedFiles.length === 0) {
    log('No conflicts found', 'success');
    process.exit(0);
  }

  log(`Found ${conflictedFiles.length} conflicted file(s)`, 'info');
  console.log('');

  // Resolve each file
  let resolved = 0;
  let manual = 0;
  let failed = 0;

  for (const file of conflictedFiles) {
    const result = resolveFile(file);
    if (result) {
      resolved++;
    } else if (requiresManualResolution(file)) {
      manual++;
    } else {
      failed++;
    }
    console.log('');
  }

  // Summary
  console.log('╔════════════════════════════════════════════╗');
  console.log('║              Summary                       ║');
  console.log('╚════════════════════════════════════════════╝\n');
  console.log(`Total conflicts: ${conflictedFiles.length}`);
  console.log(`✅ Auto-resolved: ${resolved}`);
  console.log(`⚠️  Manual resolution needed: ${manual}`);
  console.log(`❌ Failed: ${failed}`);
  console.log('');

  if (manual > 0) {
    console.log('⚠️  Manual resolution required for:');
    for (const file of conflictedFiles) {
      if (requiresManualResolution(file)) {
        console.log(`   - ${file}`);
      }
    }
    console.log('');
    console.log('After resolving manually:');
    console.log('  git add <file>');
    console.log('  git commit -m "Resolve conflicts"');
    console.log('');
  }

  if (resolved > 0 && manual === 0 && failed === 0) {
    console.log('✅ All conflicts resolved automatically!');
    console.log('');
    console.log('Next step:');
    console.log('  git commit -m "Resolve conflicts via timestamp-based resolution"');
    console.log('');
  }

  process.exit(manual > 0 || failed > 0 ? 1 : 0);
}

// Execute
main();
