/**
 * Model Manifest - Version management for cached models
 *
 * Addresses: Version Rot of Cached Models pre-mortem risk
 *
 * Features:
 * - Model versioning with SHA-256 hashes
 * - Automatic cache invalidation on version mismatch
 * - Migration support for prompt syntax changes
 */

export interface ModelManifest {
  /** Unique model identifier */
  modelId: string;
  /** Semantic version */
  version: string;
  /** SHA-256 hash of model weights */
  sha256: string;
  /** Minimum library version required */
  minLibraryVersion: string;
  /** Prompt syntax version */
  promptSyntax: "v1" | "v2";
  /** URL to download model from */
  downloadUrl: string;
  /** Total size in bytes */
  sizeBytes: number;
  /** Model capabilities */
  capabilities: {
    maxTokens: number;
    supportsStreaming: boolean;
    supportsJson: boolean;
  };
  /** When this manifest was published */
  publishedAt: string;
}

export interface CachedModelInfo {
  modelId: string;
  version: string;
  sha256: string;
  cachedAt: number;
  lastUsed: number;
  sizeBytes: number;
}

export interface ManifestValidation {
  valid: boolean;
  reason?:
    | "version_mismatch"
    | "hash_mismatch"
    | "library_outdated"
    | "not_cached";
  cachedVersion?: string;
  requiredVersion?: string;
  action?: "update" | "redownload" | "upgrade_library";
}

const MANIFEST_CACHE_KEY = "synapse_model_manifest";
const MODEL_CACHE_PREFIX = "synapse_model_";
const LIBRARY_VERSION = "0.1.0"; // Should match package.json

/**
 * Fetches the latest model manifest from CDN
 */
export async function fetchManifest(
  manifestUrl: string
): Promise<ModelManifest> {
  const response = await fetch(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch manifest: ${response.status}`);
  }
  return response.json();
}

/**
 * Gets cached model info from IndexedDB
 */
export async function getCachedModelInfo(
  modelId: string
): Promise<CachedModelInfo | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open("synapse_models", 1);

    request.onerror = () => resolve(null);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("models")) {
        db.createObjectStore("models", { keyPath: "modelId" });
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = db.transaction(["models"], "readonly");
      const store = transaction.objectStore("models");
      const getRequest = store.get(modelId);

      getRequest.onsuccess = () => resolve(getRequest.result || null);
      getRequest.onerror = () => resolve(null);
    };
  });
}

/**
 * Saves model info to IndexedDB
 */
export async function saveCachedModelInfo(
  info: CachedModelInfo
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("synapse_models", 1);

    request.onerror = () => reject(new Error("Failed to open IndexedDB"));

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("models")) {
        db.createObjectStore("models", { keyPath: "modelId" });
      }
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = db.transaction(["models"], "readwrite");
      const store = transaction.objectStore("models");
      const putRequest = store.put(info);

      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(new Error("Failed to save model info"));
    };
  });
}

/**
 * Validates cached model against manifest
 */
export async function validateCachedModel(
  manifest: ModelManifest
): Promise<ManifestValidation> {
  const cached = await getCachedModelInfo(manifest.modelId);

  if (!cached) {
    return {
      valid: false,
      reason: "not_cached",
      requiredVersion: manifest.version,
      action: "redownload",
    };
  }

  // Check version
  if (cached.version !== manifest.version) {
    return {
      valid: false,
      reason: "version_mismatch",
      cachedVersion: cached.version,
      requiredVersion: manifest.version,
      action: "update",
    };
  }

  // Check hash
  if (cached.sha256 !== manifest.sha256) {
    return {
      valid: false,
      reason: "hash_mismatch",
      cachedVersion: cached.version,
      requiredVersion: manifest.version,
      action: "redownload",
    };
  }

  // Check library version
  if (!isVersionCompatible(LIBRARY_VERSION, manifest.minLibraryVersion)) {
    return {
      valid: false,
      reason: "library_outdated",
      requiredVersion: manifest.minLibraryVersion,
      action: "upgrade_library",
    };
  }

  return { valid: true };
}

/**
 * Deletes cached model data
 */
export async function invalidateCache(modelId: string): Promise<void> {
  // Delete from IndexedDB
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("synapse_models", 1);

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const transaction = db.transaction(["models"], "readwrite");
      const store = transaction.objectStore("models");
      store.delete(modelId);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(new Error("Failed to invalidate cache"));
    };

    request.onerror = () => reject(new Error("Failed to open IndexedDB"));
  });
}

/**
 * Lists all cached models
 */
export async function listCachedModels(): Promise<CachedModelInfo[]> {
  return new Promise((resolve) => {
    const request = indexedDB.open("synapse_models", 1);

    request.onerror = () => resolve([]);

    request.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains("models")) {
        resolve([]);
        return;
      }

      const transaction = db.transaction(["models"], "readonly");
      const store = transaction.objectStore("models");
      const getAllRequest = store.getAll();

      getAllRequest.onsuccess = () => resolve(getAllRequest.result || []);
      getAllRequest.onerror = () => resolve([]);
    };
  });
}

/**
 * Simple semver comparison (checks if current >= required)
 */
function isVersionCompatible(current: string, required: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const curr = parse(current);
  const req = parse(required);

  for (let i = 0; i < 3; i++) {
    if ((curr[i] || 0) > (req[i] || 0)) return true;
    if ((curr[i] || 0) < (req[i] || 0)) return false;
  }
  return true;
}

/**
 * Calculates SHA-256 hash of an ArrayBuffer
 */
export async function calculateHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
