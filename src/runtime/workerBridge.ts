/**
 * Worker Bridge - Main thread communication with SharedWorker
 *
 * Addresses: Tab Death (OOM) and JSON.parse Bottleneck pre-mortem risks
 *
 * Features:
 * - SharedWorker for single model instance across tabs
 * - Zero-copy transfer for large payloads
 * - Memory pressure detection
 * - BroadcastChannel for multi-tab sync
 */

import { SynapseError, Errors } from "../errors";
import { estimateAvailableMemory } from "./capabilityCheck";

export interface WorkerMessage {
  id: string;
  type: "inference" | "status" | "load_model" | "unload_model";
  payload: unknown;
}

export interface WorkerResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
  transferSize?: number;
}

export interface WorkerBridgeConfig {
  /** Path to the worker script */
  workerUrl: string;
  /** Use SharedWorker if available */
  useSharedWorker?: boolean;
  /** Memory pressure threshold (0-1) */
  memoryPressureThreshold?: number;
  /** Timeout for inference requests (ms) */
  inferenceTimeout?: number;
  /** Called when memory pressure is detected */
  onMemoryPressure?: (usageRatio: number) => void;
  /** Called when worker health changes */
  onHealthChange?: (healthy: boolean) => void;
}

// Threshold for using zero-copy transfer
const TRANSFER_THRESHOLD = 10 * 1024; // 10KB

export class WorkerBridge {
  private worker: SharedWorker | Worker | null = null;
  private port: MessagePort | Worker | null = null;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeout: ReturnType<typeof setTimeout>;
    }
  > = new Map();
  private config: Required<WorkerBridgeConfig>;
  private broadcast: BroadcastChannel | null = null;
  private healthy = false;
  private lastHealthCheck = 0;

  constructor(config: WorkerBridgeConfig) {
    this.config = {
      workerUrl: config.workerUrl,
      useSharedWorker: config.useSharedWorker ?? true,
      memoryPressureThreshold: config.memoryPressureThreshold ?? 0.8,
      inferenceTimeout: config.inferenceTimeout ?? 30000,
      onMemoryPressure: config.onMemoryPressure ?? (() => {}),
      onHealthChange: config.onHealthChange ?? (() => {}),
    };
  }

  /**
   * Initializes the worker connection
   */
  async connect(): Promise<void> {
    // Try SharedWorker first
    if (this.config.useSharedWorker && typeof SharedWorker !== "undefined") {
      try {
        this.worker = new SharedWorker(this.config.workerUrl, {
          name: "synapse-runtime",
          type: "module",
        });
        this.port = (this.worker as SharedWorker).port;
        (this.port as MessagePort).start();
      } catch (e) {
        console.warn(
          "[Synapse] SharedWorker failed, falling back to Worker:",
          e
        );
      }
    }

    // Fallback to regular Worker
    if (!this.worker) {
      this.worker = new Worker(this.config.workerUrl, { type: "module" });
      this.port = this.worker;
    }

    // Set up message handling
    if (this.port) {
      this.port.onmessage = this.handleMessage.bind(this);
    }

    // Set up BroadcastChannel for multi-tab sync
    if (typeof BroadcastChannel !== "undefined") {
      this.broadcast = new BroadcastChannel("synapse-sync");
      this.broadcast.onmessage = this.handleBroadcast.bind(this);
    }

    // Health check
    await this.healthCheck();

    // Start memory monitoring
    this.startMemoryMonitoring();
  }

  /**
   * Sends a request to the worker
   */
  async send<T>(type: WorkerMessage["type"], payload: unknown): Promise<T> {
    if (!this.port) {
      throw new Error("Worker not connected");
    }

    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(Errors.inferenceTimeout("worker", this.config.inferenceTimeout));
      }, this.config.inferenceTimeout);

      this.pendingRequests.set(id, {
        resolve: resolve as any,
        reject,
        timeout,
      });

      const message: WorkerMessage = { id, type, payload };

      // Check if we should use zero-copy transfer
      const payloadStr = JSON.stringify(payload);
      if (payloadStr.length > TRANSFER_THRESHOLD) {
        const buffer = new TextEncoder().encode(payloadStr);
        this.port!.postMessage(
          { ...message, payload: buffer, isTransfer: true },
          [buffer.buffer]
        );
      } else {
        this.port!.postMessage(message);
      }
    });
  }

  /**
   * Performs inference through the worker
   */
  async inference(prompt: string): Promise<string> {
    const result = await this.send<{ content: string }>("inference", {
      prompt,
    });
    return result.content;
  }

  /**
   * Checks worker health
   */
  async healthCheck(): Promise<boolean> {
    try {
      const start = Date.now();
      await this.send("status", {});
      this.lastHealthCheck = Date.now();
      this.setHealthy(true);
      return true;
    } catch {
      this.setHealthy(false);
      return false;
    }
  }

  /**
   * Disconnects from the worker
   */
  disconnect(): void {
    // Clear pending requests
    for (const [id, request] of this.pendingRequests) {
      clearTimeout(request.timeout);
      request.reject(new Error("Worker disconnected"));
    }
    this.pendingRequests.clear();

    // Close connections
    if (this.port && "close" in this.port) {
      (this.port as MessagePort).close();
    }
    if (this.worker && "terminate" in this.worker) {
      (this.worker as Worker).terminate();
    }
    if (this.broadcast) {
      this.broadcast.close();
    }

    this.worker = null;
    this.port = null;
    this.broadcast = null;
    this.setHealthy(false);
  }

  /**
   * Gets current health status
   */
  isHealthy(): boolean {
    return this.healthy;
  }

  private handleMessage(event: MessageEvent): void {
    const response: WorkerResponse = event.data;

    // Handle transferred ArrayBuffer
    if (response.data instanceof ArrayBuffer) {
      const decoder = new TextDecoder();
      response.data = JSON.parse(decoder.decode(response.data));
    }

    const pending = this.pendingRequests.get(response.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(response.id);

      if (response.success) {
        pending.resolve(response.data);
      } else {
        pending.reject(new Error(response.error || "Unknown worker error"));
      }
    }
  }

  private handleBroadcast(event: MessageEvent): void {
    const { type, data } = event.data;

    switch (type) {
      case "model_loaded":
        console.log("[Synapse] Model loaded in another tab");
        break;
      case "model_unloaded":
        console.log("[Synapse] Model unloaded in another tab");
        break;
      case "memory_pressure":
        this.config.onMemoryPressure(data.usageRatio);
        break;
    }
  }

  private setHealthy(healthy: boolean): void {
    if (this.healthy !== healthy) {
      this.healthy = healthy;
      this.config.onHealthChange(healthy);
    }
  }

  private async startMemoryMonitoring(): Promise<void> {
    const checkMemory = async () => {
      const memory = await estimateAvailableMemory();
      if (memory.usageRatio > this.config.memoryPressureThreshold) {
        this.config.onMemoryPressure(memory.usageRatio);

        // Broadcast to other tabs
        this.broadcast?.postMessage({
          type: "memory_pressure",
          data: { usageRatio: memory.usageRatio },
        });
      }
    };

    // Check every 10 seconds
    setInterval(checkMemory, 10000);
    checkMemory();
  }
}

/**
 * Creates a worker bridge with default settings
 */
export function createWorkerBridge(config: WorkerBridgeConfig): WorkerBridge {
  return new WorkerBridge(config);
}
