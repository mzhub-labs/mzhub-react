export interface MemorySources {
  /** IndexedDB database names */
  indexedDB: string[];
  /** Cache API cache names */
  caches: string[];
  /** LocalStorage keys */
  localStorage: string[];
  /** SessionStorage keys */
  sessionStorage: string[];
}

// Default Synapse storage locations
const DEFAULT_SOURCES: MemorySources = {
  indexedDB: ["synapse_models", "synapse_downloads", "synapse_state"],
  caches: ["synapse-models", "synapse-responses"],
  localStorage: [],
  sessionStorage: [],
};

/**
 * Clears all Synapse data from the browser
 */
export async function clearAllMemory(
  sources: Partial<MemorySources> = {}
): Promise<{ success: boolean; errors: string[] }> {
  const config: MemorySources = {
    indexedDB: [...DEFAULT_SOURCES.indexedDB, ...(sources.indexedDB || [])],
    caches: [...DEFAULT_SOURCES.caches, ...(sources.caches || [])],
    localStorage: [
      ...DEFAULT_SOURCES.localStorage,
      ...(sources.localStorage || []),
    ],
    sessionStorage: [
      ...DEFAULT_SOURCES.sessionStorage,
      ...(sources.sessionStorage || []),
    ],
  };

  const errors: string[] = [];

  // Clear IndexedDB
  for (const dbName of config.indexedDB) {
    try {
      await deleteIndexedDB(dbName);
    } catch (e) {
      errors.push(
        `Failed to delete IndexedDB "${dbName}": ${(e as Error).message}`
      );
    }
  }

  // Clear Cache API
  for (const cacheName of config.caches) {
    try {
      await caches.delete(cacheName);
    } catch (e) {
      errors.push(
        `Failed to delete cache "${cacheName}": ${(e as Error).message}`
      );
    }
  }

  // Clear LocalStorage
  for (const key of config.localStorage) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      errors.push(
        `Failed to remove localStorage "${key}": ${(e as Error).message}`
      );
    }
  }

  // Clear SessionStorage
  for (const key of config.sessionStorage) {
    try {
      sessionStorage.removeItem(key);
    } catch (e) {
      errors.push(
        `Failed to remove sessionStorage "${key}": ${(e as Error).message}`
      );
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Deletes an IndexedDB database
 */
function deleteIndexedDB(dbName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Failed to delete ${dbName}`));
    request.onblocked = () => {
      // Database is blocked, wait and retry
      setTimeout(() => {
        const retryRequest = indexedDB.deleteDatabase(dbName);
        retryRequest.onsuccess = () => resolve();
        retryRequest.onerror = () =>
          reject(new Error(`Failed to delete ${dbName} (blocked)`));
      }, 100);
    };
  });
}

/**
 * Gets storage usage for Synapse data
 */
export async function getMemoryUsage(): Promise<{
  total: number;
  breakdown: Record<string, number>;
}> {
  const breakdown: Record<string, number> = {};
  let total = 0;

  // Estimate IndexedDB size
  if ("storage" in navigator && "estimate" in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate();
      const used = estimate.usage || 0;
      breakdown["storage"] = used;
      total += used;
    } catch {
      // Ignore
    }
  }

  // Cache API size
  try {
    const cacheNames = await caches.keys();
    for (const name of cacheNames) {
      if (DEFAULT_SOURCES.caches.some((n) => name.includes(n))) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        // Rough estimate: 1KB per entry (we can't easily get actual sizes)
        breakdown[`cache:${name}`] = keys.length * 1024;
        total += keys.length * 1024;
      }
    }
  } catch {
    // Ignore
  }

  return { total, breakdown };
}

/**
 * Registers handlers for browser clear-data events
 * Note: This is best-effort as browsers don't provide a reliable event
 */
export function registerClearDataHandler(onClear: () => void): () => void {
  // Listen for storage events (partial solution)
  const handler = (e: StorageEvent) => {
    if (e.key === null) {
      // localStorage.clear() was called
      onClear();
    }
  };

  window.addEventListener("storage", handler);

  return () => {
    window.removeEventListener("storage", handler);
  };
}

/**
 * Synapse memory API - convenience wrapper
 */
export const SynapseMemory = {
  clear: clearAllMemory,
  getUsage: getMemoryUsage,
  onClear: registerClearDataHandler,
};
