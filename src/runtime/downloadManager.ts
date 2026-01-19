/**
 * Download Manager - Background model downloading with resume support
 *
 * Addresses: 2GB Bounce Rate Wall pre-mortem risk
 *
 * Features:
 * - Resumable downloads with Range headers
 * - Progress callbacks
 * - Integrity verification (SHA-256)
 * - IndexedDB + Cache API storage
 */

import { calculateHash, saveCachedModelInfo } from "./modelManifest";

export interface DownloadProgress {
  modelId: string;
  bytesDownloaded: number;
  totalBytes: number;
  percent: number;
  speed: number; // bytes per second
  estimatedTimeRemaining: number | null;
}

export interface DownloadOptions {
  /** Called with download progress */
  onProgress?: (progress: DownloadProgress) => void;
  /** Called when download completes */
  onComplete?: (modelId: string) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

interface DownloadState {
  modelId: string;
  url: string;
  totalBytes: number;
  downloadedBytes: number;
  chunks: ArrayBuffer[];
  startTime: number;
  lastProgressTime: number;
}

const DB_NAME = "synapse_downloads";
const STORE_NAME = "chunks";

/**
 * Download manager for background model downloads
 */
export class DownloadManager {
  private activeDownloads: Map<string, DownloadState> = new Map();

  /**
   * Starts or resumes a model download
   */
  async download(
    modelId: string,
    url: string,
    expectedHash: string,
    options: DownloadOptions = {}
  ): Promise<ArrayBuffer> {
    const { onProgress, onComplete, onError, signal } = options;

    // Check for existing partial download
    const existingChunks = await this.loadPartialDownload(modelId);
    const resumeFrom = existingChunks ? existingChunks.byteLength : 0;

    try {
      // Start download with Range header for resume
      const headers: HeadersInit = {};
      if (resumeFrom > 0) {
        headers["Range"] = `bytes=${resumeFrom}-`;
      }

      const response = await fetch(url, { headers, signal });

      if (!response.ok && response.status !== 206) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const contentLength = parseInt(
        response.headers.get("content-length") || "0"
      );
      const totalBytes = resumeFrom + contentLength;

      const state: DownloadState = {
        modelId,
        url,
        totalBytes,
        downloadedBytes: resumeFrom,
        chunks: existingChunks ? [existingChunks] : [],
        startTime: Date.now(),
        lastProgressTime: Date.now(),
      };
      this.activeDownloads.set(modelId, state);

      // Stream the response
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      while (true) {
        const { done, value } = await reader.read();

        if (signal?.aborted) {
          await this.savePartialDownload(modelId, state);
          throw new Error("Download cancelled");
        }

        if (done) break;

        state.chunks.push(value.buffer);
        state.downloadedBytes += value.byteLength;

        // Calculate progress
        const now = Date.now();
        const elapsed = (now - state.startTime) / 1000;
        const speed = state.downloadedBytes / elapsed;
        const remaining = totalBytes - state.downloadedBytes;
        const eta = speed > 0 ? remaining / speed : null;

        onProgress?.({
          modelId,
          bytesDownloaded: state.downloadedBytes,
          totalBytes,
          percent: Math.round((state.downloadedBytes / totalBytes) * 100),
          speed,
          estimatedTimeRemaining: eta,
        });

        // Save checkpoint every 10MB
        if (state.downloadedBytes - resumeFrom > 10 * 1024 * 1024) {
          await this.savePartialDownload(modelId, state);
        }
      }

      // Combine all chunks
      const completeBuffer = this.combineChunks(state.chunks);

      // Verify hash
      const actualHash = await calculateHash(completeBuffer);
      if (actualHash !== expectedHash) {
        await this.clearPartialDownload(modelId);
        throw new Error(
          `Hash mismatch: expected ${expectedHash}, got ${actualHash}`
        );
      }

      // Save to cache
      await this.saveToCache(modelId, completeBuffer);
      await this.clearPartialDownload(modelId);

      // Update model info
      await saveCachedModelInfo({
        modelId,
        version: "1.0.0", // Should come from manifest
        sha256: actualHash,
        cachedAt: Date.now(),
        lastUsed: Date.now(),
        sizeBytes: completeBuffer.byteLength,
      });

      this.activeDownloads.delete(modelId);
      onComplete?.(modelId);

      return completeBuffer;
    } catch (error) {
      this.activeDownloads.delete(modelId);
      onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Cancels an active download
   */
  cancel(modelId: string): void {
    const state = this.activeDownloads.get(modelId);
    if (state) {
      this.savePartialDownload(modelId, state);
      this.activeDownloads.delete(modelId);
    }
  }

  /**
   * Gets progress of active download
   */
  getProgress(modelId: string): DownloadProgress | null {
    const state = this.activeDownloads.get(modelId);
    if (!state) return null;

    const elapsed = (Date.now() - state.startTime) / 1000;
    const speed = state.downloadedBytes / elapsed;
    const remaining = state.totalBytes - state.downloadedBytes;

    return {
      modelId,
      bytesDownloaded: state.downloadedBytes,
      totalBytes: state.totalBytes,
      percent: Math.round((state.downloadedBytes / state.totalBytes) * 100),
      speed,
      estimatedTimeRemaining: speed > 0 ? remaining / speed : null,
    };
  }

  /**
   * Loads model from cache
   */
  async loadFromCache(modelId: string): Promise<ArrayBuffer | null> {
    try {
      const cache = await caches.open("synapse-models");
      const response = await cache.match(modelId);
      if (response) {
        return response.arrayBuffer();
      }
    } catch {
      // Cache API not available
    }
    return null;
  }

  private combineChunks(chunks: ArrayBuffer[]): ArrayBuffer {
    const totalLength = chunks.reduce(
      (sum, chunk) => sum + chunk.byteLength,
      0
    );
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    return result.buffer;
  }

  private async savePartialDownload(
    modelId: string,
    state: DownloadState
  ): Promise<void> {
    const buffer = this.combineChunks(state.chunks);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction([STORE_NAME], "readwrite");
        tx.objectStore(STORE_NAME).put(buffer, modelId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error("Failed to save partial download"));
      };

      request.onerror = () => reject(new Error("Failed to open IndexedDB"));
    });
  }

  private async loadPartialDownload(
    modelId: string
  ): Promise<ArrayBuffer | null> {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onerror = () => resolve(null);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction([STORE_NAME], "readonly");
        const getRequest = tx.objectStore(STORE_NAME).get(modelId);
        getRequest.onsuccess = () => resolve(getRequest.result || null);
        getRequest.onerror = () => resolve(null);
      };
    });
  }

  private async clearPartialDownload(modelId: string): Promise<void> {
    return new Promise((resolve) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onsuccess = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const tx = db.transaction([STORE_NAME], "readwrite");
        tx.objectStore(STORE_NAME).delete(modelId);
        tx.oncomplete = () => resolve();
      };
      request.onerror = () => resolve();
    });
  }

  private async saveToCache(
    modelId: string,
    buffer: ArrayBuffer
  ): Promise<void> {
    try {
      const cache = await caches.open("synapse-models");
      const response = new Response(buffer);
      await cache.put(modelId, response);
    } catch {
      // Cache API not available, model saved only in IndexedDB
    }
  }
}

/**
 * Creates a download manager instance
 */
export function createDownloadManager(): DownloadManager {
  return new DownloadManager();
}
