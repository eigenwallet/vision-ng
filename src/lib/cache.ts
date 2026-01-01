import fs from 'fs';
import path from 'path';

const CACHE_DIR = '.cache';
const CACHE_DURATION_MS = 10 * 60 * 1000; // 10 minutes

interface CachedData<T> {
  data: T;
  timestamp: number;
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCacheFilePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

export function getCache<T>(key: string): T | null {
  try {
    const cachePath = getCacheFilePath(key);
    if (!fs.existsSync(cachePath)) {
      return null;
    }

    const content = fs.readFileSync(cachePath, 'utf-8');
    const cached: CachedData<T> = JSON.parse(content);

    const now = Date.now();
    if (now - cached.timestamp < CACHE_DURATION_MS) {
      console.log(`Using cached data for: ${key}`);
      return cached.data;
    } else {
      console.log(`Cache expired for: ${key}`);
      return null;
    }
  } catch (error) {
    console.warn(`Failed to read cache for ${key}:`, error);
    return null;
  }
}

export function setCache<T>(key: string, data: T): void {
  try {
    ensureCacheDir();
    const cachePath = getCacheFilePath(key);
    const cached: CachedData<T> = {
      data,
      timestamp: Date.now(),
    };
    fs.writeFileSync(cachePath, JSON.stringify(cached, null, 2));
    console.log(`Cached data for: ${key}`);
  } catch (error) {
    console.warn(`Failed to write cache for ${key}:`, error);
  }
}
