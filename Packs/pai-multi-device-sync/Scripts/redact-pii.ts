#!/usr/bin/env bun
/**
 * PII Redaction Script - PAI Multi-Device Sync
 *
 * Processes memory files and generates PII-safe versions:
 * - .safe.md: Full version with [PII:TYPE] → [REDACTED:TYPE]
 * - .quick.md: Condensed version (~50-70% smaller) with redactions
 *
 * Based on Framework v2.2.0 redact_pii.py, rewritten in TypeScript for PAI.
 *
 * @version 1.0.0
 * @author Luis Romano
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Configuration
const MEMORY_DIR = join(homedir(), '.claude-memory-cloud');

// PII marker pattern: [PII:TYPE]value[/PII:TYPE]
const PII_MARKER_PATTERN = /\[PII:(\w+)\](.*?)\[\/PII:\1\]/gs;

// Logging helper
function log(message: string) {
  console.error(`[PII Redaction] ${message}`);
}

/**
 * Redact PII markers in content
 * [PII:EMAIL]user@example.com[/PII:EMAIL] → [REDACTED:EMAIL]
 */
function redactPII(content: string): string {
  return content.replace(PII_MARKER_PATTERN, (match, type) => {
    return `[REDACTED:${type}]`;
  });
}

/**
 * Generate quick (condensed) version of content
 * Keeps essential sections only, reduces by ~50-70%
 */
function generateQuickVersion(content: string): string {
  const lines = content.split('\n');
  const quickLines: string[] = [];

  // Track which sections to include
  const includeSections = new Set([
    '# PAI Global Memory',
    '## User Profile',
    '## Collaboration Patterns',
    '## Active Projects',
    '## Recent Context'
  ]);

  let inIncludedSection = false;
  let currentSection = '';
  let headerLevel = 0;

  for (const line of lines) {
    // Check if line is a header
    const headerMatch = line.match(/^(#{1,3})\s+(.+)$/);

    if (headerMatch) {
      const level = headerMatch[1].length;
      const title = headerMatch[2];
      const fullHeader = `${'#'.repeat(level)} ${title}`;

      // Check if this is an included section
      if (includeSections.has(fullHeader)) {
        inIncludedSection = true;
        currentSection = fullHeader;
        headerLevel = level;
        quickLines.push(line);
      } else if (level <= headerLevel) {
        // New section at same or higher level - stop including
        inIncludedSection = false;
      }
    } else if (inIncludedSection) {
      // Include content lines
      // Skip empty lines at section start
      if (line.trim() !== '' || quickLines.length > 0 && quickLines[quickLines.length - 1].trim() !== '') {
        quickLines.push(line);
      }
    }
  }

  // Add metadata at end
  quickLines.push('');
  quickLines.push('---');
  quickLines.push('');
  quickLines.push(`**Quick version generated**: ${new Date().toISOString()}`);
  quickLines.push(`**Token reduction**: ~${Math.round((1 - quickLines.length / lines.length) * 100)}%`);

  return quickLines.join('\n');
}

/**
 * Process a single markdown file
 */
function processFile(filePath: string): void {
  try {
    log(`Processing: ${filePath}`);

    // Read original content
    const content = readFileSync(filePath, 'utf-8');

    // Generate .safe.md (full version, PII redacted)
    const safeContent = redactPII(content);
    const safeFilePath = filePath.replace(/\.md$/, '.safe.md');
    writeFileSync(safeFilePath, safeContent);
    log(`  → Generated: ${safeFilePath}`);

    // Generate .quick.md (condensed version, PII redacted)
    const quickContent = generateQuickVersion(safeContent);
    const quickFilePath = filePath.replace(/\.md$/, '.quick.md');
    writeFileSync(quickFilePath, quickContent);

    // Calculate stats
    const originalLines = content.split('\n').length;
    const quickLines = quickContent.split('\n').length;
    const reduction = Math.round((1 - quickLines / originalLines) * 100);

    log(`  → Generated: ${quickFilePath} (${reduction}% smaller)`);

    // Count redactions
    const redactionCount = (safeContent.match(/\[REDACTED:\w+\]/g) || []).length;
    if (redactionCount > 0) {
      log(`  → Redactions: ${redactionCount} PII markers replaced`);
    }

  } catch (error) {
    log(`  ❌ Error processing ${filePath}: ${error}`);
  }
}

/**
 * Find all .md files to process
 */
function findMarkdownFiles(): string[] {
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
          // Include .md files, but exclude .safe.md and .quick.md
          if (fullPath.endsWith('.md') &&
              !fullPath.endsWith('.safe.md') &&
              !fullPath.endsWith('.quick.md')) {
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

/**
 * Main execution
 */
function main() {
  try {
    log('Starting PII redaction...');

    // Check if memory directory exists
    if (!existsSync(MEMORY_DIR)) {
      log(`❌ Memory directory not found: ${MEMORY_DIR}`);
      log('   Run installation first.');
      process.exit(1);
    }

    // Find all markdown files
    const files = findMarkdownFiles();

    if (files.length === 0) {
      log('No markdown files found to process');
      process.exit(0);
    }

    log(`Found ${files.length} markdown file(s) to process`);
    log('');

    // Process each file
    for (const file of files) {
      processFile(file);
    }

    log('');
    log(`✅ PII redaction complete (${files.length} file(s) processed)`);
    process.exit(0);

  } catch (error) {
    log(`❌ Fatal error: ${error}`);
    process.exit(1);
  }
}

// Execute if run directly
if (import.meta.main) {
  main();
}

// Export for use in hooks
export { redactPII, generateQuickVersion, processFile };
