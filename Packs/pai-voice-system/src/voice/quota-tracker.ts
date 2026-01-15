#!/usr/bin/env bun
/**
 * ElevenLabs Quota Tracker
 *
 * Tracks character usage and prevents exceeding quota.
 * Falls back to local TTS (Fish Audio S1) when quota is low.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const QUOTA_FILE = join(homedir(), '.config', 'pai', 'elevenlabs-quota.json');
const QUOTA_THRESHOLD = 500;  // Characters remaining before fallback

interface QuotaData {
  characterCount: number;
  characterLimit: number;
  resetUnix: number;
  lastUpdated: string;
  provider: 'elevenlabs' | 'fish-audio';
}

/**
 * Get current quota from ElevenLabs API
 */
export async function fetchQuotaFromAPI(apiKey: string): Promise<QuotaData | null> {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
      headers: { 'xi-api-key': apiKey }
    });

    if (!response.ok) {
      console.warn('[QuotaTracker] Failed to fetch quota:', response.status);
      return null;
    }

    const data = await response.json() as {
      character_count: number;
      character_limit: number;
      next_character_count_reset_unix: number;
    };

    return {
      characterCount: data.character_count,
      characterLimit: data.character_limit,
      resetUnix: data.next_character_count_reset_unix,
      lastUpdated: new Date().toISOString(),
      provider: 'elevenlabs'
    };
  } catch (error) {
    console.error('[QuotaTracker] API error:', error);
    return null;
  }
}

/**
 * Load cached quota data
 */
export function loadQuotaCache(): QuotaData | null {
  try {
    if (existsSync(QUOTA_FILE)) {
      const content = readFileSync(QUOTA_FILE, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // Ignore cache errors
  }
  return null;
}

/**
 * Save quota data to cache
 */
export function saveQuotaCache(data: QuotaData): void {
  try {
    const dir = join(homedir(), '.config', 'pai');
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    writeFileSync(QUOTA_FILE, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('[QuotaTracker] Failed to save cache:', error);
  }
}

/**
 * Get remaining characters
 */
export function getRemainingCharacters(data: QuotaData): number {
  return data.characterLimit - data.characterCount;
}

/**
 * Check if we should use fallback TTS
 */
export function shouldUseFallback(data: QuotaData | null, messageLength: number): boolean {
  if (!data) {
    // Can't check quota, assume OK
    return false;
  }

  const remaining = getRemainingCharacters(data);

  // Use fallback if:
  // 1. Remaining chars below threshold
  // 2. Message would exceed remaining
  return remaining < QUOTA_THRESHOLD || messageLength > remaining;
}

/**
 * Update local character count (estimate)
 */
export function trackUsage(messageLength: number): void {
  const cached = loadQuotaCache();
  if (cached) {
    cached.characterCount += messageLength;
    cached.lastUpdated = new Date().toISOString();
    saveQuotaCache(cached);
  }
}

/**
 * Get quota status for display
 */
export function getQuotaStatus(): string {
  const cached = loadQuotaCache();
  if (!cached) {
    return '⚠️ Quota unknown (API key needs user_read permission)';
  }

  const remaining = getRemainingCharacters(cached);
  const percent = Math.round((remaining / cached.characterLimit) * 100);
  const resetDate = new Date(cached.resetUnix * 1000).toLocaleDateString();

  if (remaining < QUOTA_THRESHOLD) {
    return `🔴 ${remaining}/${cached.characterLimit} chars (${percent}%) - Using fallback TTS | Resets: ${resetDate}`;
  } else if (remaining < cached.characterLimit * 0.2) {
    return `🟡 ${remaining}/${cached.characterLimit} chars (${percent}%) - Low quota | Resets: ${resetDate}`;
  } else {
    return `🟢 ${remaining}/${cached.characterLimit} chars (${percent}%) | Resets: ${resetDate}`;
  }
}

// CLI tool
if (import.meta.main) {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  console.log('📊 ElevenLabs Quota Tracker\n');

  if (apiKey) {
    console.log('Fetching quota from API...');
    const quota = await fetchQuotaFromAPI(apiKey);

    if (quota) {
      saveQuotaCache(quota);
      console.log(`\n${getQuotaStatus()}`);
      console.log(`\nDetails:`);
      console.log(`  Used: ${quota.characterCount}`);
      console.log(`  Limit: ${quota.characterLimit}`);
      console.log(`  Remaining: ${getRemainingCharacters(quota)}`);
      console.log(`  Fallback threshold: ${QUOTA_THRESHOLD}`);
    } else {
      console.log('❌ Could not fetch quota (check API key permissions)');
      const cached = loadQuotaCache();
      if (cached) {
        console.log(`\nUsing cached data from ${cached.lastUpdated}:`);
        console.log(getQuotaStatus());
      }
    }
  } else {
    console.log('❌ ELEVENLABS_API_KEY not set');
  }
}
