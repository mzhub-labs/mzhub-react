/**
 * Capability Check - Verify hardware before trusting local AI
 *
 * Addresses: Silent WebGPU Failure pre-mortem risk
 */

import { Errors } from "../errors";

export interface CapabilityResult {
  /** WebGPU is available and working */
  webgpu: boolean;
  /** WebGL2 fallback available */
  webgl2: boolean;
  /** SharedArrayBuffer available (needed for some WASM) */
  sharedArrayBuffer: boolean;
  /** Estimated VRAM in MB (0 if unknown) */
  estimatedVRAM: number;
  /** Browser supports Web Workers */
  webWorkers: boolean;
  /** Browser supports SharedWorker */
  sharedWorkers: boolean;
  /** IndexedDB available for model caching */
  indexedDB: boolean;
  /** Sanity inference test passed */
  sanityTestPassed: boolean;
  /** Recommended inference mode */
  recommendedMode: "local" | "cloud" | "hybrid";
  /** Detailed capability scores */
  scores: {
    gpu: number; // 0-100
    memory: number; // 0-100
    browser: number; // 0-100
    overall: number; // 0-100
  };
  /** Any issues detected */
  issues: string[];
}

/**
 * Checks all capabilities needed for local AI inference
 */
export async function checkCapabilities(): Promise<CapabilityResult> {
  const issues: string[] = [];

  // Check WebGPU
  let webgpu = false;
  let estimatedVRAM = 0;

  if ("gpu" in navigator) {
    try {
      const adapter = await (navigator as any).gpu.requestAdapter();
      if (adapter) {
        webgpu = true;
        // Try to get VRAM estimate from adapter limits
        const info = await adapter.requestAdapterInfo?.();
        if (info?.memoryHeaps) {
          estimatedVRAM = Math.round(info.memoryHeaps[0].size / (1024 * 1024));
        }
      } else {
        issues.push("WebGPU adapter not available");
      }
    } catch (e) {
      issues.push(`WebGPU error: ${(e as Error).message}`);
    }
  } else {
    issues.push("WebGPU not supported in this browser");
  }

  // Check WebGL2
  let webgl2 = false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    webgl2 = !!gl;
    if (!webgl2) {
      issues.push("WebGL2 not available");
    }
  } catch {
    issues.push("WebGL2 check failed");
  }

  // Check SharedArrayBuffer
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  if (!sharedArrayBuffer) {
    issues.push("SharedArrayBuffer not available (may need COOP/COEP headers)");
  }

  // Check Web Workers
  const webWorkers = typeof Worker !== "undefined";
  if (!webWorkers) {
    issues.push("Web Workers not supported");
  }

  // Check SharedWorker
  const sharedWorkers = typeof SharedWorker !== "undefined";
  if (!sharedWorkers) {
    issues.push("SharedWorker not supported (multi-tab optimization disabled)");
  }

  // Check IndexedDB
  let indexedDB = false;
  try {
    indexedDB = !!window.indexedDB;
  } catch {
    issues.push("IndexedDB not available");
  }

  // Calculate scores
  const gpuScore = webgpu ? 100 : webgl2 ? 50 : 0;
  const memoryScore =
    estimatedVRAM >= 4096
      ? 100
      : estimatedVRAM >= 2048
      ? 75
      : estimatedVRAM > 0
      ? 50
      : 25;
  const browserScore = Math.round(
    (webWorkers ? 25 : 0) +
      (sharedWorkers ? 25 : 0) +
      (indexedDB ? 25 : 0) +
      (sharedArrayBuffer ? 25 : 0)
  );
  const overallScore = Math.round((gpuScore + memoryScore + browserScore) / 3);

  // Determine recommended mode
  let recommendedMode: "local" | "cloud" | "hybrid";
  if (overallScore >= 80 && webgpu) {
    recommendedMode = "local";
  } else if (overallScore >= 40) {
    recommendedMode = "hybrid";
  } else {
    recommendedMode = "cloud";
  }

  return {
    webgpu,
    webgl2,
    sharedArrayBuffer,
    estimatedVRAM,
    webWorkers,
    sharedWorkers,
    indexedDB,
    sanityTestPassed: false, // Will be set by runSanityTest
    recommendedMode,
    scores: {
      gpu: gpuScore,
      memory: memoryScore,
      browser: browserScore,
      overall: overallScore,
    },
    issues,
  };
}

/**
 * Runs a simple sanity test to verify the AI model produces valid output
 * This catches driver bugs that cause garbage/NaN output
 */
export async function runSanityTest(
  inference: (prompt: string) => Promise<string>
): Promise<{ passed: boolean; details: string }> {
  const testCases = [
    { prompt: "What is 2+2? Reply with just the number.", expected: "4" },
    { prompt: 'Return valid JSON: {"test": true}', contains: '"test"' },
  ];

  for (const test of testCases) {
    try {
      const result = await inference(test.prompt);

      // Check for NaN or garbage
      if (result.includes("NaN") || result.includes("undefined")) {
        return {
          passed: false,
          details: `Sanity test failed: got NaN/undefined in response`,
        };
      }

      // Check expected content
      if (test.expected && !result.includes(test.expected)) {
        return {
          passed: false,
          details: `Sanity test failed: expected "${test.expected}" in response`,
        };
      }
      if (test.contains && !result.includes(test.contains)) {
        return {
          passed: false,
          details: `Sanity test failed: expected "${test.contains}" in response`,
        };
      }
    } catch (e) {
      return {
        passed: false,
        details: `Sanity test error: ${(e as Error).message}`,
      };
    }
  }

  return { passed: true, details: "All sanity tests passed" };
}

/**
 * Estimates available memory for model loading
 */
export async function estimateAvailableMemory(): Promise<{
  available: number;
  total: number;
  usageRatio: number;
}> {
  // Try performance.measureUserAgentSpecificMemory if available
  if ("measureUserAgentSpecificMemory" in performance) {
    try {
      const measurement = await (
        performance as any
      ).measureUserAgentSpecificMemory();
      const used = measurement.bytes / (1024 * 1024);
      // Estimate total as 4GB for Chrome
      const total = 4096;
      return {
        available: total - used,
        total,
        usageRatio: used / total,
      };
    } catch {
      // Fallback
    }
  }

  // Fallback: use performance.memory if available (Chrome only)
  if ("memory" in performance) {
    const memory = (performance as any).memory;
    const used = memory.usedJSHeapSize / (1024 * 1024);
    const total = memory.jsHeapSizeLimit / (1024 * 1024);
    return {
      available: total - used,
      total,
      usageRatio: used / total,
    };
  }

  // No memory info available
  return {
    available: 2048, // Assume 2GB available
    total: 4096,
    usageRatio: 0.5,
  };
}
