#!/usr/bin/env bun
/**
 * PrePush Hook - PAI Multi-Device Sync
 *
 * Verifies no unredacted PII in files before pushing to cloud.
 * Implements defense-in-depth for PII protection.
 *
 * Based on Framework v2.2.0 patterns, adapted for PAI hooks.
 *
 * @version 1.0.0
 * @author Luis Romano
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, relative } from 'path';

// Configuration
const MEMORY_DIR = join(homedir(), '.claude-memory-cloud');
const CONFIG_FILE = join(MEMORY_DIR, '.config.json');

// PII detection patterns
const PII_PATTERNS = {
  email: {
    regex: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
    description: 'Email address'
  },
  phone: {
    regex: /\+?\d{1,3}[\s-]?\(?\d{1,4}\)?[\s-]?\d{1,4}[\s-]?\d{1,9}/g,
    description: 'Phone number'
  },
  apiKey: {
    regex: /sk-[a-zA-Z0-9]{20,}/g,
    description: 'OpenAI API key'
  },
  awsKey: {
    regex: /AKIA[0-9A-Z]{16}/g,
    description: 'AWS access key'
  },
  jwt: {
    regex: /eyJ[a-zA-Z0-9_-]{5,}\.eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}/g,
    description: 'JWT token'
  },
  githubToken: {
    regex: /ghp_[a-zA-Z0-9]{36}/g,
    description: 'GitHub personal access token'
  },
  creditCard: {
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    description: 'Credit card number'
  },
  ssn: {
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    description: 'Social security number'
  }
};

interface Config {
  version: string;
  privacy: {
    redact_pii: boolean;
    auto_redact: string[];
    cloud_safe_only: boolean;
  };
}

// Logging helper
function log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
  const prefix = level === 'error' ? '[❌ PrePush]' :
                 level === 'warn' ? '[⚠️  PrePush]' :
                 '[✅ PrePush]';
  console.error(`${prefix} ${message}`);
}

// Load configuration
function loadConfig(): Config | null {
  try {
    if (!existsSync(CONFIG_FILE)) {
      log('No config found - PII check disabled', 'warn');
      return null;
    }
    const content = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    log(`Failed to load config: ${error}`, 'error');
    return null;
  }
}

// Check file for PII
function checkFileForPII(filePath: string): { hasPII: boolean; findings: string[] } {
  const findings: string[] = [];

  try {
    // Skip binary files and certain extensions
    if (filePath.match(/\.(jpg|jpeg|png|gif|pdf|zip|tar|gz|exe|dll|so|dylib)$/i)) {
      return { hasPII: false, findings };
    }

    // Skip git directory
    if (filePath.includes('.git/')) {
      return { hasPII: false, findings };
    }

    // Read file content
    const content = readFileSync(filePath, 'utf-8');

    // Check against each pattern
    for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
      const matches = content.match(pattern.regex);
      if (matches && matches.length > 0) {
        // Check if it's within a [PII:TYPE] marker (already marked for redaction)
        const isMarked = content.includes(`[PII:${type.toUpperCase()}]`) ||
                        content.includes(`[REDACTED:${type.toUpperCase()}]`);

        if (!isMarked) {
          findings.push(`${pattern.description} (${matches.length} occurrence${matches.length > 1 ? 's' : ''})`);
        }
      }
    }

    return {
      hasPII: findings.length > 0,
      findings
    };

  } catch (error) {
    // Skip files that can't be read as text
    return { hasPII: false, findings };
  }
}

// Get all files to check
function getFilesToCheck(): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip .git directory
          if (entry !== '.git') {
            walk(fullPath);
          }
        } else if (stat.isFile()) {
          // Check .safe.md and .quick.md files (should never have PII)
          if (fullPath.match(/\.(safe|quick)\.md$/)) {
            files.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  walk(MEMORY_DIR);
  return files;
}

// Main execution
async function main() {
  try {
    // Read event from stdin (PAI hook format)
    const input = readFileSync(0, 'utf-8');
    const event = JSON.parse(input);

    log('PrePush event received');

    // Load configuration
    const config = loadConfig();
    if (!config || !config.privacy.redact_pii) {
      log('PII checking disabled in config');
      process.exit(0);  // Allow push
    }

    log('Checking for unredacted PII...');

    // Get files to check
    const filesToCheck = getFilesToCheck();

    if (filesToCheck.length === 0) {
      log('No files to check');
      process.exit(0);  // Allow push
    }

    log(`Checking ${filesToCheck.length} file(s)...`);

    // Check each file
    const piiDetected: { file: string; findings: string[] }[] = [];

    for (const file of filesToCheck) {
      const result = checkFileForPII(file);
      if (result.hasPII) {
        piiDetected.push({
          file: relative(MEMORY_DIR, file),
          findings: result.findings
        });
      }
    }

    // Report results
    if (piiDetected.length > 0) {
      log('PII DETECTED - PUSH BLOCKED', 'error');
      console.error('');
      console.error('🔒 SECURITY: Unredacted PII found in the following files:');
      console.error('');

      for (const item of piiDetected) {
        console.error(`  ❌ ${item.file}`);
        for (const finding of item.findings) {
          console.error(`     - ${finding}`);
        }
        console.error('');
      }

      console.error('⚠️  ACTION REQUIRED:');
      console.error('   1. Review the files listed above');
      console.error('   2. Wrap sensitive data with PII markers:');
      console.error('      [PII:EMAIL]user@example.com[/PII:EMAIL]');
      console.error('      [PII:API]sk-proj-abc123[/PII:API]');
      console.error('   3. Close session again (will regenerate .safe.md files)');
      console.error('   4. Push will then succeed');
      console.error('');

      process.exit(2);  // Exit code 2 = BLOCK push

    } else {
      log(`All files PII-safe (${filesToCheck.length} checked)`);
      process.exit(0);  // Allow push
    }

  } catch (error) {
    log(`Hook error: ${error}`, 'error');
    process.exit(0);  // On error, don't block (fail open for availability)
  }
}

// Execute
main();
