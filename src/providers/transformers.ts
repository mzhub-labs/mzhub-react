/**
 * Transformers.js Provider - Local AI inference
 *
 * Wraps @xenova/transformers for browser-based model execution.
 * This is the "Engine" that Synapse wraps with safety and state management.
 *
 * Supports: Text generation, summarization, translation, etc.
 */

import { AIProvider, InferenceOptions, InferenceResponse } from "./openai";

export type TransformersTask =
  | "text-generation"
  | "text2text-generation"
  | "summarization"
  | "translation";

export interface TransformersConfig {
  /** Model ID from Hugging Face (e.g., 'Xenova/gpt2', 'Xenova/distilgpt2') */
  modelId: string;
  /** Task type */
  task?: TransformersTask;
  /** Use WebGPU acceleration if available */
  useWebGPU?: boolean;
  /** Cache models locally */
  cacheModels?: boolean;
  /** Called when model loading starts */
  onLoadStart?: () => void;
  /** Called with loading progress */
  onLoadProgress?: (progress: number) => void;
  /** Called when model is ready */
  onLoadComplete?: () => void;
  /** Custom quantization (e.g., 'q4', 'q8') */
  quantization?: string;
}

// Pipeline cache to avoid reloading models
const pipelineCache = new Map<string, unknown>();

/**
 * Dynamically imports @xenova/transformers
 * This allows the library to work even if transformers.js isn't installed
 */
async function getTransformers(): Promise<
  typeof import("@xenova/transformers")
> {
  try {
    const moduleName = "@xenova/transformers";
    const transformers = await import(/* @vite-ignore */ moduleName);
    return transformers;
  } catch (error) {
    throw new Error(
      "@xenova/transformers is not installed. Run: npm install @xenova/transformers"
    );
  }
}

/**
 * Creates a local inference provider using Transformers.js
 */
export function createTransformersProvider(
  config: TransformersConfig
): AIProvider & {
  isLoaded: () => boolean;
  preload: () => Promise<void>;
  unload: () => void;
} {
  const {
    modelId,
    task = "text-generation",
    useWebGPU = true,
    cacheModels = true,
    onLoadStart,
    onLoadProgress,
    onLoadComplete,
    quantization,
  } = config;

  let pipeline: unknown = null;
  let isLoading = false;
  let loadError: Error | null = null;

  const cacheKey = `${modelId}:${task}:${quantization || "default"}`;

  async function ensurePipeline(): Promise<unknown> {
    // Return cached pipeline if available
    if (pipelineCache.has(cacheKey)) {
      return pipelineCache.get(cacheKey);
    }

    if (pipeline) return pipeline;

    if (isLoading) {
      // Wait for current load to complete
      return new Promise((resolve, reject) => {
        const checkInterval = setInterval(() => {
          if (pipeline) {
            clearInterval(checkInterval);
            resolve(pipeline);
          } else if (loadError) {
            clearInterval(checkInterval);
            reject(loadError);
          }
        }, 100);
      });
    }

    isLoading = true;
    onLoadStart?.();

    try {
      const transformers = await getTransformers();

      // Configure environment
      if (!cacheModels) {
        (transformers.env as { cacheDir?: string }).cacheDir = "";
      }

      // Create progress callback
      const progressCallback = (info: { progress?: number }) => {
        if (typeof info.progress === "number") {
          onLoadProgress?.(info.progress);
        }
      };

      // Build options
      const pipelineOptions: Record<string, unknown> = {
        progress_callback: progressCallback,
      };

      // Enable WebGPU if available and requested
      if (useWebGPU && typeof navigator !== "undefined" && "gpu" in navigator) {
        pipelineOptions.device = "webgpu";
      }

      if (quantization) {
        pipelineOptions.quantized = true;
        pipelineOptions.revision = quantization;
      }

      // Create the pipeline
      pipeline = await transformers.pipeline(task, modelId, pipelineOptions);

      // Cache it
      pipelineCache.set(cacheKey, pipeline);

      onLoadComplete?.();
      return pipeline;
    } catch (error) {
      loadError = error instanceof Error ? error : new Error(String(error));
      throw loadError;
    } finally {
      isLoading = false;
    }
  }

  return {
    name: "transformers",

    async inference(
      prompt: string,
      options: InferenceOptions = {}
    ): Promise<InferenceResponse> {
      const pipe = (await ensurePipeline()) as (
        text: string,
        opts?: Record<string, unknown>
      ) => Promise<
        Array<{
          generated_text?: string;
          summary_text?: string;
          translation_text?: string;
        }>
      >;

      const generateOptions: Record<string, unknown> = {
        max_new_tokens: options.maxTokens ?? 256,
        temperature: options.temperature ?? 0.7,
        do_sample: (options.temperature ?? 0.7) > 0,
      };

      const result = await pipe(prompt, generateOptions);

      // Handle different task output formats
      let content = "";
      if (result && result[0]) {
        content =
          result[0].generated_text ||
          result[0].summary_text ||
          result[0].translation_text ||
          "";

        // For text-generation, remove the input prompt from output
        if (task === "text-generation" && content.startsWith(prompt)) {
          content = content.slice(prompt.length).trim();
        }
      }

      return {
        content,
        finishReason: "stop",
      };
    },

    // Streaming for local models
    async *streamInference(
      prompt: string,
      options: InferenceOptions = {}
    ): AsyncIterable<string> {
      const pipe = (await ensurePipeline()) as (
        text: string,
        opts?: Record<string, unknown>
      ) => Promise<Array<{ generated_text?: string }>>;

      // For now, we generate the full response and yield it in chunks
      // True streaming requires TextStreamer support in transformers.js
      const generateOptions: Record<string, unknown> = {
        max_new_tokens: options.maxTokens ?? 256,
        temperature: options.temperature ?? 0.7,
        do_sample: (options.temperature ?? 0.7) > 0,
      };

      const result = await pipe(prompt, generateOptions);

      let content = result[0]?.generated_text || "";

      if (task === "text-generation" && content.startsWith(prompt)) {
        content = content.slice(prompt.length).trim();
      }

      // Simulate streaming by yielding words
      const words = content.split(" ");
      for (let i = 0; i < words.length; i++) {
        yield words[i] + (i < words.length - 1 ? " " : "");
        // Small delay to simulate streaming
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },

    isLoaded(): boolean {
      return pipeline !== null || pipelineCache.has(cacheKey);
    },

    async preload(): Promise<void> {
      await ensurePipeline();
    },

    unload(): void {
      pipeline = null;
      pipelineCache.delete(cacheKey);
    },
  };
}

/**
 * Preload a model in the background
 */
export async function preloadModel(
  modelId: string,
  task: TransformersTask = "text-generation",
  onProgress?: (progress: number) => void
): Promise<void> {
  const provider = createTransformersProvider({
    modelId,
    task,
    onLoadProgress: onProgress,
  });
  await provider.preload();
}

/**
 * Clear the pipeline cache
 */
export function clearPipelineCache(): void {
  pipelineCache.clear();
}
