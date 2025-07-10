/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { xai } from '@ai-sdk/xai';
import { generateText, streamText } from 'ai';
import { Config } from '../config/config.js'; // Assuming a similar config structure
import {
  logApiRequest,
  logApiResponse,
  logApiError,
} from '../telemetry/loggers.js'; // Assuming similar logging
import {
  ApiErrorEvent,
  ApiRequestEvent,
  ApiResponseEvent,
} from '../telemetry/types.js'; // Assuming similar telemetry types

// Placeholder for message history and content types, will need to align with 'ai' SDK
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class GrokChat {
  private history: ChatMessage[] = [];
  private xaiClient;

  constructor(
    private readonly config: Config, // Assuming Config provides API key and model info
    // private readonly generationConfig: any = {}, // Placeholder for generation config
  ) {
    // API key should be handled securely, e.g., from config or environment variables
    const apiKey = this.config.getApiKey('xai'); // Assumes a method to get API key
    if (!apiKey) {
      // In a real scenario, we'd throw an error or handle this more gracefully
      console.warn('XAI API key not found. Using XAI_API_KEY env variable if set.');
    }

    this.xaiClient = createXai({
      apiKey: apiKey || undefined, // createXai will use env var if apiKey is undefined
      // baseURL: this.config.getBaseUrl('xai'), // Optional: if custom base URL is needed
    });
  }

  private _logApiRequest(
    prompt: string,
    model: string,
    prompt_id: string,
  ): void {
    logApiRequest(
      this.config,
      new ApiRequestEvent(model, prompt_id, prompt),
    );
  }

  private _logApiResponse(
    durationMs: number,
    prompt_id: string,
    // usageMetadata?: any, // TODO: Check what usage metadata Grok API/SDK provides
    responseText?: string,
  ): void {
    logApiResponse(
      this.config,
      new ApiResponseEvent(
        this.config.getGrokModel(), // Assuming a method to get Grok model
        durationMs,
        prompt_id,
        undefined, // TODO: usageMetadata
        responseText,
      ),
    );
  }

  private _logApiError(
    durationMs: number,
    error: unknown,
    prompt_id: string,
  ): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorType = error instanceof Error ? error.name : 'unknown';

    logApiError(
      this.config,
      new ApiErrorEvent(
        this.config.getGrokModel(), // Assuming a method to get Grok model
        errorMessage,
        durationMs,
        prompt_id,
        errorType,
      ),
    );
  }

  async sendMessage(
    prompt: string,
    prompt_id: string,
  ): Promise<string> {
    const modelId = this.config.getGrokModel(); // e.g., "grok-3" or "grok-4-0709"
    if (!modelId) {
      throw new Error("Grok model ID not configured.");
    }

    this._logApiRequest(prompt, modelId, prompt_id);
    const startTime = Date.now();

    try {
      // For simplicity, starting with generateText.
      // For actual chat, we'll need to manage history and use the chat-specific APIs from `ai` package
      // like `experimental_generateObject` or build messages array for `generateText` or `streamText`.

      // Construct messages array for generateText
      const messages: ChatMessage[] = [
        ...this.history,
        { role: 'user', content: prompt },
      ];

      const { text, usage, finishReason, rawResponse } = await generateText({
        model: this.xaiClient(modelId), // Use the configured model
        messages: messages.map(m => ({role: m.role, content: m.content})), // Map to the expected format
        // temperature: this.generationConfig.temperature, // Example
        // maxTokens: this.generationConfig.maxTokens, // Example
      });

      const durationMs = Date.now() - startTime;
      // TODO: Extract usage metadata if available from `usage` or `rawResponse`
      this._logApiResponse(durationMs, prompt_id, undefined, text);

      // Add user prompt and model response to history
      this.history.push({ role: 'user', content: prompt });
      this.history.push({ role: 'assistant', content: text });

      return text;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this._logApiError(durationMs, error, prompt_id);
      throw error;
    }
  }

  // Basic history management (can be expanded)
  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  setHistory(messages: ChatMessage[]): void {
    this.history = [...messages];
  }
}

// Helper to create the XAI client, can be customized
function createXai(options?: { apiKey?: string; baseURL?: string }) {
  return xai(options?.apiKey, options);
}
