/**
 * Type declarations for @xenova/transformers
 *
 * This allows the library to work without hard dependency on transformers.js
 */

declare module "@xenova/transformers" {
  interface TransformersEnv {
    cacheDir?: string;
    allowRemoteModels?: boolean;
    allowLocalModels?: boolean;
    backends?: {
      onnx?: unknown;
    };
  }

  export const env: TransformersEnv;

  export type Task =
    | "text-generation"
    | "text2text-generation"
    | "summarization"
    | "translation"
    | "question-answering"
    | "fill-mask"
    | "token-classification"
    | "text-classification"
    | "zero-shot-classification"
    | "feature-extraction";

  export interface PipelineOptions {
    device?: "cpu" | "webgpu" | "wasm";
    quantized?: boolean;
    revision?: string;
    progress_callback?: (info: {
      progress?: number;
      file?: string;
      loaded?: number;
      total?: number;
    }) => void;
  }

  export interface GenerationOptions {
    max_new_tokens?: number;
    max_length?: number;
    min_length?: number;
    temperature?: number;
    top_k?: number;
    top_p?: number;
    do_sample?: boolean;
    num_beams?: number;
    repetition_penalty?: number;
    no_repeat_ngram_size?: number;
  }

  export interface TextGenerationOutput {
    generated_text: string;
  }

  export interface SummarizationOutput {
    summary_text: string;
  }

  export interface TranslationOutput {
    translation_text: string;
  }

  export type PipelineOutput =
    | TextGenerationOutput[]
    | SummarizationOutput[]
    | TranslationOutput[];

  export type Pipeline = (
    input: string | string[],
    options?: GenerationOptions
  ) => Promise<PipelineOutput>;

  export function pipeline(
    task: Task,
    model?: string,
    options?: PipelineOptions
  ): Promise<Pipeline>;
}
