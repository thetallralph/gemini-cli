/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GrokChat } from './grokChat.js';
import { Config, LLMProvider } from '../config/config.js'; // Assuming Config is in this path
import { streamText, experimental_generateText as generateText } from 'ai'; // For mocking

// Mock the 'ai' module
vi.mock('ai', async () => {
  const actual = await vi.importActual('ai');
  return {
    ...actual,
    experimental_streamText: vi.fn(),
    experimental_generateText: vi.fn(),
  };
});

// Mock the '@ai-sdk/xai' module
// It exports a function `xai` which is a model factory, and `xai.provider`
const mockXaiProvider = vi.fn();
const mockXaiModelInstance = vi.fn();
vi.mock('@ai-sdk/xai', () => ({
  default: Object.assign(mockXaiModelInstance, { provider: mockXaiProvider }),
}));


// Mock telemetry loggers
vi.mock('../telemetry/loggers', () => ({
  logApiRequest: vi.fn(),
  logApiResponse: vi.fn(),
  logApiError: vi.fn(),
}));

describe('GrokChat', () => {
  let mockConfig: Config;
  let grokChat: GrokChat;

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();

    // Mock Config instance
    mockConfig = {
      getApiKey: vi.fn(),
      getGrokModel: vi.fn(),
      getSelectedLlmProvider: vi.fn(() => LLMProvider.GROK), // Assume Grok is selected
      // Add other necessary mock methods for Config if GrokChat uses them
    } as unknown as Config;

    // Mock return values for config
    vi.spyOn(mockConfig, 'getApiKey').mockReturnValue('test-grok-api-key');
    vi.spyOn(mockConfig, 'getGrokModel').mockReturnValue('grok-test-model');

    // Setup the xai provider mock to return a model factory function
    const modelFactory = vi.fn(() => 'mocked-xai-model-run-instance'); // This is what `this.xaiProvider(modelId)` returns
    mockXaiProvider.mockReturnValue(modelFactory);


    grokChat = new GrokChat(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize xaiProvider with API key from config', () => {
      expect(mockConfig.getApiKey).toHaveBeenCalledWith('grok');
      expect(mockXaiProvider).toHaveBeenCalledWith({
        apiKey: 'test-grok-api-key',
      });
    });

    it('should use XAI_API_KEY from env if config does not provide one', () => {
      vi.spyOn(mockConfig, 'getApiKey').mockReturnValue(undefined);
      process.env.XAI_API_KEY = 'env-grok-key';
      new GrokChat(mockConfig); // Re-initialize to pick up new mock
      expect(mockXaiProvider).toHaveBeenCalledWith({
        apiKey: 'env-grok-key',
      });
      delete process.env.XAI_API_KEY;
    });
  });

  describe('sendMessage', () => {
    it('should call generateText with correct parameters and update history', async () => {
      const prompt = 'Hello Grok!';
      const promptId = 'test-prompt-id';
      const mockResponse = {
        text: 'Hello there!',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: 'stop' as const,
        toolCalls: [],
        toolResults: [],
        rawResponse: undefined,
        warnings: [],
      };
      (generateText as vi.Mock).mockResolvedValue(mockResponse);

      const responseText = await grokChat.sendMessage(prompt, promptId);

      expect(generateText).toHaveBeenCalledWith({
        model: 'mocked-xai-model-run-instance', // what xaiProvider(modelId) returns
        messages: [{ role: 'user', content: prompt }],
      });
      expect(responseText).toBe('Hello there!');
      expect(grokChat.getHistory()).toEqual([
        { role: 'user', content: prompt },
        { role: 'assistant', content: 'Hello there!' },
      ]);
    });

    it('should include system prompt if provided and not in history', async () => {
      const prompt = 'User message';
      const systemPrompt = 'System instruction';
      (generateText as vi.Mock).mockResolvedValue({ text: 'Response', usage: {}, finishReason: 'stop' });

      await grokChat.sendMessage(prompt, 'pid', systemPrompt);

      expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      }));
    });

    it('should handle errors from generateText', async () => {
      const prompt = 'Test error';
      const promptId = 'error-prompt-id';
      const error = new Error('API error');
      (generateText as vi.Mock).mockRejectedValue(error);

      await expect(grokChat.sendMessage(prompt, promptId)).rejects.toThrow('API error');
      // logApiError should have been called by the catch block in sendMessage
      // expect(logApiError).toHaveBeenCalled(); // Need to import and spy on logApiError
    });
  });

  describe('sendMessageStream', () => {
    it('should call streamText and yield parts, then update history', async () => {
      const prompt = 'Stream this!';
      const promptId = 'stream-id';
      const mockStreamParts = [
        { type: 'text-delta', textDelta: 'Hel' },
        { type: 'text-delta', textDelta: 'lo,' },
        { type: 'text-delta', textDelta: ' Grok!' },
        { type: 'finish', finishReason: 'stop', usage: { promptTokens: 4, completionTokens: 3, totalTokens: 7 } },
      ] as const; // Use `as const` for type safety with discriminated unions

      async function* mockStream() {
        for (const part of mockStreamParts) {
          yield part;
        }
      }
      (streamText as vi.Mock).mockResolvedValue(mockStream());

      const receivedParts = [];
      for await (const part of grokChat.sendMessageStream(prompt, promptId)) {
        receivedParts.push(part);
      }

      expect(streamText).toHaveBeenCalledWith({
        model: 'mocked-xai-model-run-instance',
        messages: [{ role: 'user', content: prompt }],
        signal: undefined, // Or expect.any(AbortSignal) if always passed
      });

      expect(receivedParts).toEqual(mockStreamParts);
      expect(grokChat.getHistory()).toEqual([
        { role: 'user', content: prompt },
        { role: 'assistant', content: 'Hello, Grok!' },
      ]);
    });

    it('should handle errors from streamText', async () => {
      const prompt = 'Stream error test';
      const promptId = 'stream-error-id';
      const error = new Error('Stream API error');
      (streamText as vi.Mock).mockRejectedValue(error);

      try {
        // Collect parts to ensure the generator is consumed
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        for await (const _ of grokChat.sendMessageStream(prompt, promptId)) { /* consume */ }
        throw new Error("Stream should have thrown"); // Should not reach here
      } catch (e) {
        expect(e).toBe(error);
      }
      // logApiError should have been called
    });
  });

  describe('history management', () => {
    it('should clear history', () => {
      grokChat.setHistory([{ role: 'user', content: 'test' }]);
      expect(grokChat.getHistory().length).toBe(1);
      grokChat.clearHistory();
      expect(grokChat.getHistory().length).toBe(0);
    });

    it('should set history', () => {
      const newHistory = [
        { role: 'user', content: 'msg1' },
        { role: 'assistant', content: 'msg2' },
      ] as const; // Use `as const` for Message[] if Message type is strict
      grokChat.setHistory(newHistory.map(m => ({...m}))); // map to satisfy Message type if stricter
      expect(grokChat.getHistory()).toEqual(newHistory);
    });
  });
});

// Helper to ensure the mock setup for xai provider is correct
describe('XAI Provider Mocking Details', () => {
    it('mockXaiProvider should return a function, which then returns the model run instance', () => {
        const providerFn = mockXaiProvider(); // This is like `xai.provider()`
        expect(typeof providerFn).toBe('function'); // This is the `modelFactory`

        const modelRunInstance = providerFn('grok-test-model'); // This is like `xaiProvider(modelId)`
        expect(modelRunInstance).toBe('mocked-xai-model-run-instance');
    });
});
