/**
 * SynapseProvider - React context for global AI configuration
 */

import React, { createContext, useContext, useMemo, ReactNode } from "react";
import { AIProvider, createOpenAIProvider, OpenAIConfig } from "../providers";

export interface SynapseConfig {
  /** OpenAI API key or compatible provider key */
  apiKey?: string;
  /** Base URL for the API (default: OpenAI) */
  baseUrl?: string;
  /** Model to use (default: gpt-4o-mini) */
  model?: string;
  /** Default temperature for inference */
  temperature?: number;
  /** Maximum tokens for responses */
  maxTokens?: number;
  /** Confidence threshold for automatic acceptance (0-1) */
  confidenceThreshold?: number;
  /** Maximum retry attempts for self-correction */
  maxRetries?: number;
  /** Enable debug logging */
  debug?: boolean;
  /** Custom AI provider (overrides apiKey/baseUrl/model) */
  provider?: AIProvider;
}

export interface SynapseContextValue {
  config: Required<
    Omit<SynapseConfig, "apiKey" | "baseUrl" | "model" | "provider">
  > & {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  provider: AIProvider;
  log: (...args: unknown[]) => void;
}

const DEFAULT_CONFIG: SynapseContextValue["config"] = {
  temperature: 0.7,
  maxTokens: 2048,
  confidenceThreshold: 0.7,
  maxRetries: 3,
  debug: false,
};

const SynapseContext = createContext<SynapseContextValue | null>(null);

export interface SynapseProviderProps {
  config: SynapseConfig;
  children: ReactNode;
}

export function SynapseProvider({ config, children }: SynapseProviderProps) {
  const value = useMemo<SynapseContextValue>(() => {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    const log = mergedConfig.debug
      ? (...args: unknown[]) => console.log("[Synapse]", ...args)
      : () => {};

    // Use custom provider or create OpenAI provider
    const provider =
      config.provider ||
      createOpenAIProvider({
        apiKey: config.apiKey || "",
        baseUrl: config.baseUrl,
        model: config.model,
        defaultOptions: {
          temperature: mergedConfig.temperature,
          maxTokens: mergedConfig.maxTokens,
        },
      });

    return {
      config: mergedConfig,
      provider,
      log,
    };
  }, [config]);

  return (
    <SynapseContext.Provider value={value}>{children}</SynapseContext.Provider>
  );
}

export function useSynapseContext(): SynapseContextValue {
  const context = useContext(SynapseContext);
  if (!context) {
    throw new Error("useSynapseContext must be used within a SynapseProvider");
  }
  return context;
}

/**
 * Hook to check if Synapse is configured
 */
export function useSynapseConfig() {
  const context = useContext(SynapseContext);
  return {
    isConfigured: !!context,
    config: context?.config,
  };
}
