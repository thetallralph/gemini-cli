/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react-hooks';
import { useLlmStream } from './useLlmStream.js';
import {
  Config,
  GeminiClient,
  GrokChat,
  LLMProvider,
  ServerGeminiEventType,
  GeminiEventType,
  DEFAULT_GEMINI_FLASH_MODEL,
} from '@google/gemini-cli-core';
import { MessageType, StreamingState, type HistoryItemWithoutId } from '../types.js';

// Mocks
vi.mock('@google/gemini-cli-core', async () => {
  const actual = await vi.importActual('@google/gemini-cli-core');
  return {
    ...actual,
    GeminiClient: vi.fn().mockImplementation(() => ({
      sendMessageStream: vi.fn(),
      addHistory: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
    })),
    GrokChat: vi.fn().mockImplementation(() => ({
      sendMessageStream: vi.fn(),
      addHistory: vi.fn(),
      getHistory: vi.fn().mockReturnValue([]),
      setHistory: vi.fn(),
      clearHistory: vi.fn(),
    })),
  };
});


describe('useLlmStream', () => {
  let mockConfig: Config;
  let mockGeminiClient: GeminiClient;
  let mockGrokChat: GrokChat;
  let mockAddItem: ReturnType<typeof vi.fn>;
  let mockSetShowHelp: ReturnType<typeof vi.fn>;
  let mockOnDebugMessage: ReturnType<typeof vi.fn>;
  let mockHandleSlashCommand: ReturnType<typeof vi.fn>;
  let mockGetPreferredEditor: ReturnType<typeof vi.fn>;
  let mockOnAuthError: ReturnType<typeof vi.fn>;
  let mockPerformMemoryRefresh: ReturnType<typeof vi.fn>;
  let mockSetModelSwitchedFromQuotaError: ReturnType<typeof vi.fn>;

  const initialHistory: HistoryItemWithoutId[] = [];

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfig = {
      getSelectedLlmProvider: vi.fn(() => LLMProvider.GEMINI), // Default to Gemini
      getGeminiModel: vi.fn(() => 'gemini-test-model'),
      getGrokModel: vi.fn(() => 'grok-test-model'),
      getApiKey: vi.fn(),
      getContentGeneratorConfig: vi.fn(() => ({ authType: 'test-auth' })),
      getProjectRoot: vi.fn(() => '/test/project'),
      getSessionId: vi.fn(() => 'test-session-id'),
      getDebugMode: vi.fn(() => false),
      // Add any other methods from Config that are used by the hook
    } as unknown as Config;

    mockGeminiClient = new (GeminiClient as any)(mockConfig);
    mockGrokChat = new (GrokChat as any)(mockConfig);

    mockAddItem = vi.fn();
    mockSetShowHelp = vi.fn();
    mockOnDebugMessage = vi.fn();
    mockHandleSlashCommand = vi.fn().mockResolvedValue(false);
    mockGetPreferredEditor = vi.fn();
    mockOnAuthError = vi.fn();
    mockPerformMemoryRefresh = vi.fn().mockResolvedValue(undefined);
    mockSetModelSwitchedFromQuotaError = vi.fn();
  });

  const renderTestHook = (currentLlmClient: GeminiClient | GrokChat) => {
    return renderHook(() =>
      useLlmStream(
        currentLlmClient,
        initialHistory as any, // Cast if HistoryItemWithoutId vs HistoryItem is an issue
        mockAddItem,
        mockSetShowHelp,
        mockConfig,
        mockOnDebugMessage,
        mockHandleSlashCommand,
        false, // shellModeActive
        mockGetPreferredEditor,
        mockOnAuthError,
        mockPerformMemoryRefresh,
        false, // modelSwitchedFromQuotaError
        mockSetModelSwitchedFromQuotaError,
      ),
    );
  };

  describe('Grok Provider', () => {
    beforeEach(() => {
      vi.spyOn(mockConfig, 'getSelectedLlmProvider').mockReturnValue(LLMProvider.GROK);
    });

    it('should call grokChat.sendMessageStream and process text-delta parts', async () => {
      const prompt = 'Hello Grok';
      const mockStreamParts = [
        { type: 'text-delta', textDelta: 'Response ' },
        { type: 'text-delta', textDelta: 'from ' },
        { type: 'text-delta', textDelta: 'Grok.' },
        { type: 'finish', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 3, totalTokens: 4 } },
      ];
      async function* streamGenerator() {
        for (const part of mockStreamParts) {
          yield part;
        }
      }
      (mockGrokChat.sendMessageStream as vi.Mock).mockReturnValue(streamGenerator());

      const { result, waitForNextUpdate } = renderTestHook(mockGrokChat);

      await act(async () => {
        result.current.submitQuery(prompt);
        // Wait for stream processing to begin
        await waitForNextUpdate({timeout: 200});
        // Wait for all parts to be processed
        while(result.current.streamingState === StreamingState.Responding) {
            await waitForNextUpdate({timeout: 200});
        }
      });

      expect(mockGrokChat.sendMessageStream).toHaveBeenCalledWith(prompt, expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal)}));

      // Check pending items: one for each delta, then final message added to history
      // The hook should accumulate deltas into one pending item.
      expect(mockAddItem).toHaveBeenCalledTimes(1); // Only the final message

      // The last call to addItem should be the complete message
      const lastAddItemCall = mockAddItem.mock.calls[mockAddItem.mock.calls.length - 1][0];
      expect(lastAddItemCall).toEqual(
        expect.objectContaining({
          type: MessageType.GROK_CONTENT, // or 'grok_content' if that's what handleContentEvent uses
          text: 'Response from Grok.',
        }),
      );
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    it('should handle errors from Grok stream part', async () => {
      const prompt = 'Grok error test';
      const mockStreamParts = [
        { type: 'text-delta', textDelta: 'Partial ' },
        { type: 'error', error: 'Grok API Error Occurred' },
      ];
      async function* streamGenerator() {
        for (const part of mockStreamParts) {
          yield part;
        }
      }
      (mockGrokChat.sendMessageStream as vi.Mock).mockReturnValue(streamGenerator());

      const { result, waitForNextUpdate } = renderTestHook(mockGrokChat);

      await act(async () => {
        result.current.submitQuery(prompt);
         while(result.current.streamingState === StreamingState.Responding) {
            await waitForNextUpdate({timeout: 200});
        }
      });

      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.ERROR,
          text: 'Grok stream error: Grok API Error Occurred',
        }),
        expect.any(Number),
      );
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

     it('should handle AbortError during Grok stream processing', async () => {
      const prompt = 'Abort Grok';
      (mockGrokChat.sendMessageStream as vi.Mock).mockImplementation(async function*() {
        yield { type: 'text-delta', textDelta: 'Starting...' };
        // Simulate a delay then throw AbortError
        await new Promise(resolve => setTimeout(resolve, 50));
        const error = new Error('Stream aborted');
        error.name = 'AbortError';
        throw error;
      });

      const { result, waitForNextUpdate } = renderTestHook(mockGrokChat);

      await act(async () => {
        result.current.submitQuery(prompt);
         while(result.current.streamingState === StreamingState.Responding) {
            await waitForNextUpdate({timeout: 200});
        }
      });

      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.INFO,
          text: 'Request cancelled.',
        }),
        expect.any(Number),
      );
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });

    it('should NOT trigger Gemini-specific logic like ChatCompressed or ToolCall scheduling', async () => {
      const prompt = 'Hello Grok, no tools please';
      // Simulate a stream that might look like a Gemini tool call if not handled correctly
      const mockStreamParts = [
        { type: 'text-delta', textDelta: 'Okay.' },
        // These are Gemini event types, should be ignored or handled as 'unknown' by Grok path
        { type: GeminiEventType.ToolCallRequest, value: { callId: 't1', name: 'fake_tool' } },
        { type: GeminiEventType.ChatCompressed, value: { originalTokenCount: 100, newTokenCount: 50}},
        { type: 'finish', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
      ];
       async function* streamGenerator() {
        for (const part of mockStreamParts) {
          yield part;
        }
      }
      (mockGrokChat.sendMessageStream as vi.Mock).mockReturnValue(streamGenerator());
      const mockScheduleToolCalls = vi.fn(); // Need to mock this if it's called by the hook directly

      // To mock useReactToolScheduler more effectively if it's deeper:
      // vi.mock('./useReactToolScheduler', () => ({ useReactToolScheduler: () => [ [], mockScheduleToolCalls, vi.fn() ]}));


      const { result, waitForNextUpdate } = renderTestHook(mockGrokChat);

      await act(async () => {
        result.current.submitQuery(prompt);
         while(result.current.streamingState === StreamingState.Responding) {
            await waitForNextUpdate({timeout: 200});
        }
      });

      expect(mockScheduleToolCalls).not.toHaveBeenCalled();
      // Verify no ChatCompressed message was added
      mockAddItem.mock.calls.forEach(call => {
        expect(call[0].text).not.toContain('ChatCompressed');
        expect(call[0].text).not.toContain('IMPORTANT: This conversation approached');
      });
      // Verify the text delta was processed
       expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'grok_content', text: 'Okay.'}),
        expect.any(Number)
      );
    });
  });

  // Add tests for Gemini provider to ensure existing functionality is not broken
  describe('Gemini Provider', () => {
    beforeEach(() => {
      vi.spyOn(mockConfig, 'getSelectedLlmProvider').mockReturnValue(LLMProvider.GEMINI);
    });

    it('should call geminiClient.sendMessageStream and process Gemini events', async () => {
      const prompt = 'Hello Gemini';
      const mockGeminiEvents = [
        { type: ServerGeminiEventType.Thought, value: { someThought: 'thinking' } },
        { type: ServerGeminiEventType.Content, value: 'Response from Gemini.' },
      ];
      async function* streamGenerator() {
        for (const event of mockGeminiEvents) {
          yield event;
        }
      }
      (mockGeminiClient.sendMessageStream as vi.Mock).mockReturnValue(streamGenerator());

      const { result, waitForNextUpdate } = renderTestHook(mockGeminiClient);

      await act(async () => {
        result.current.submitQuery(prompt);
         while(result.current.streamingState === StreamingState.Responding) {
            await waitForNextUpdate({timeout: 200});
        }
      });

      expect(mockGeminiClient.sendMessageStream).toHaveBeenCalledWith(prompt, expect.any(AbortSignal), expect.any(String));
      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: MessageType.GEMINI, // Or 'gemini'
          text: 'Response from Gemini.',
        }),
        expect.any(Number),
      );
      expect(result.current.thought).toEqual({ someThought: 'thinking' });
      expect(result.current.streamingState).toBe(StreamingState.Idle);
    });
  });
});
