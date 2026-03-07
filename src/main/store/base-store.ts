/**
 * Base Store Factory
 * Creates a type-safe JSON store with common read/write operations
 */

import fs from 'fs';
import { ensureStorageDir } from './storage-path';

export interface StoreOptions<T> {
  /** Function to get the store file path */
  getPath: () => string;
  /** Default data when store doesn't exist */
  defaultData: T;
}

export interface Store<T> {
  /** Read current data from store */
  read(): T;
  /** Write data to store */
  write(data: T): void;
  /** Get the store file path */
  getPath(): string;
}

/**
 * Create a type-safe JSON store
 */
export function createStore<T>(options: StoreOptions<T>): Store<T> {
  const { getPath, defaultData } = options;

  function read(): T {
    try {
      const raw = fs.readFileSync(getPath(), 'utf-8');
      return { ...defaultData, ...(JSON.parse(raw) as Partial<T>) };
    } catch {
      return { ...defaultData };
    }
  }

  function write(data: T): void {
    ensureStorageDir();
    fs.writeFileSync(getPath(), JSON.stringify(data, null, 2), 'utf-8');
  }

  return {
    read,
    write,
    getPath,
  };
}

/**
 * Create a store that merges with defaults on read
 * Useful for stores with optional fields that have defaults
 */
export function createMergingStore<T extends object>(options: StoreOptions<T>): Store<T> {
  const { getPath, defaultData } = options;

  function read(): T {
    try {
      const raw = fs.readFileSync(getPath(), 'utf-8');
      const saved = JSON.parse(raw) as Partial<T>;
      // Deep merge with defaults
      return deepMerge(defaultData, saved);
    } catch {
      return { ...defaultData };
    }
  }

  function write(data: T): void {
    ensureStorageDir();
    fs.writeFileSync(getPath(), JSON.stringify(data, null, 2), 'utf-8');
  }

  return {
    read,
    write,
    getPath,
  };
}

/**
 * Deep merge two objects (target is modified, source values override)
 */
function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    const targetValue = target[key];
    if (
      sourceValue !== undefined &&
      sourceValue !== null &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue !== undefined &&
      targetValue !== null &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key as string] = deepMerge(
        targetValue as object,
        sourceValue as object,
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key as string] = sourceValue;
    }
  }
  return result;
}
