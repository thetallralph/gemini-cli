import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import {
  Config,
  ConfigParameters,
  sessionId,
  DEFAULT_GEMINI_MODEL,
  FileDiscoveryService,
  ToolRegistry,
  GeminiClient,
  ContentGeneratorConfig,
  AuthType,
} from '@google/gemini-cli-core';

// Get current directory for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create Fastify instance with logging
const server = fastify({ logger: true });

// Register static file serving for the public directory
server.register(fastifyStatic, {
  root: path.join(__dirname, '../public'),
  prefix: '/', // optional: default '/'
});

// Helper function to process @ commands
async function processAtCommands(prompt: string, config: Config, toolRegistry: ToolRegistry): Promise<string> {
  // Simple @ command detection
  if (!prompt.includes('@')) {
    return prompt;
  }

  // Find @ commands in the prompt
  const atRegex = /@([^\s]+)/g;
  const matches = [...prompt.matchAll(atRegex)];
  
  if (matches.length === 0) {
    return prompt;
  }

  const fileDiscovery = config.getFileService();
  const respectGitIgnore = config.getFileFilteringRespectGitIgnore();
  const readManyFilesTool = toolRegistry.getTool('read_many_files');

  if (!readManyFilesTool) {
    console.warn('read_many_files tool not found, processing prompt without file context');
    return prompt;
  }

  const pathsToRead: string[] = [];
  let processedPrompt = prompt;

  // Process each @ command
  for (const match of matches) {
    const fullMatch = match[0]; // e.g., "@package.json"
    const pathName = match[1]; // e.g., "package.json"

    // Check if path should be ignored
    if (fileDiscovery.shouldIgnoreFile(pathName, { respectGitIgnore })) {
      console.log(`Path ${pathName} is ignored and will be skipped.`);
      continue;
    }

    // Resolve path (similar to CLI logic)
    try {
      const absolutePath = path.resolve(config.getTargetDir(), pathName);
      const fs = await import('fs/promises');
      const stats = await fs.stat(absolutePath);
      
      if (stats.isDirectory()) {
        pathsToRead.push(pathName.endsWith('/') ? `${pathName}**` : `${pathName}/**`);
      } else {
        pathsToRead.push(pathName);
      }
    } catch (error) {
      console.warn(`Path ${pathName} not found or inaccessible`);
      continue;
    }
  }

  // Read files if any valid paths were found
  if (pathsToRead.length > 0) {
    try {
      const result = await readManyFilesTool.execute(
        { paths: pathsToRead, respect_git_ignore: respectGitIgnore },
        new AbortController().signal
      );

      if (result.llmContent && Array.isArray(result.llmContent)) {
        // Add file content to the prompt
        let fileContent = '\n--- Content from referenced files ---\n';
        
        for (const part of result.llmContent) {
          if (typeof part === 'string') {
            const fileContentRegex = /^--- (.*?) ---\n\n([\s\S]*?)\n\n$/;
            const match = fileContentRegex.exec(part);
            if (match) {
              const filePath = match[1];
              const content = match[2].trim();
              fileContent += `\nContent from @${filePath}:\n${content}\n`;
            } else {
              fileContent += part;
            }
          }
        }
        fileContent += '\n--- End of content ---\n';
        
        // Append file content to the original prompt
        processedPrompt = prompt + fileContent;
      }
    } catch (error) {
      console.error('Error reading files:', error);
      // Continue with original prompt if file reading fails
    }
  }

  return processedPrompt;
}

// API endpoint for handling prompts
server.post('/api/prompt', async (request, reply) => {
  try {
    const { prompt } = request.body as { prompt: string };
    const debugInfo: Array<{type: string, message: string}> = [];

    if (!prompt || typeof prompt !== 'string') {
      return reply.status(400).send({
        error: 'Invalid request',
        details: 'Prompt is required and must be a string',
      });
    }

    debugInfo.push({ type: 'info', message: `📝 Received prompt: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"` });
    server.log.info(`Received prompt: ${prompt.substring(0, 100)}...`);

    // Get API key from environment
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      debugInfo.push({ type: 'error', message: '❌ GEMINI_API_KEY not found in environment variables' });
      console.error('Environment variables:', Object.keys(process.env).filter(k => k.includes('GEMINI')));
      console.error('Current working directory:', process.cwd());
      return reply.status(500).send({
        error: 'Configuration error',
        details: 'GEMINI_API_KEY not found in environment variables',
        debug_info: debugInfo,
      });
    }

    debugInfo.push({ type: 'success', message: `🔑 API Key loaded (length: ${apiKey.length})` });

    // Initialize Gemini CLI Core configuration for @ command processing
    let processedPrompt = prompt;
    
    if (prompt.includes('@')) {
      debugInfo.push({ type: 'info', message: '🔍 @ commands detected, initializing CLI core...' });
      
      try {
        const configParams: ConfigParameters = {
          sessionId: sessionId,
          targetDir: process.cwd(),
          debugMode: false,
          cwd: process.cwd(),
          model: DEFAULT_GEMINI_MODEL,
          fileDiscoveryService: new FileDiscoveryService(process.cwd()),
        };
        
        debugInfo.push({ type: 'info', message: `📁 Working directory: ${process.cwd()}` });
        
        const config = new Config(configParams);
        await config.initialize();
        
        debugInfo.push({ type: 'success', message: '⚙️ CLI configuration initialized' });
        
        const toolRegistry = await config.getToolRegistry();
        debugInfo.push({ type: 'success', message: '🔧 Tool registry loaded' });
        
        // Process @ commands to include file context
        const originalLength = prompt.length;
        processedPrompt = await processAtCommands(prompt, config, toolRegistry);
        
        const filesAdded = processedPrompt.length - originalLength;
        if (filesAdded > 0) {
          debugInfo.push({ type: 'success', message: `📖 @ commands processed: +${filesAdded} characters of file content added` });
        } else {
          debugInfo.push({ type: 'warning', message: '⚠️ @ commands found but no file content was added' });
        }
        
        console.log('@ command processed, prompt length:', processedPrompt.length);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        debugInfo.push({ type: 'error', message: `❌ @ command processing failed: ${errorMsg}` });
        console.error('Error processing @ commands:', error);
        // Continue with original prompt if @ command processing fails
        processedPrompt = prompt + '\n\n(Note: @ command processing encountered an error, continuing without file context)';
      }
    } else {
      debugInfo.push({ type: 'info', message: '💬 No @ commands detected, using prompt as-is' });
    }

         // Use direct Gemini API call for reliability
     debugInfo.push({ type: 'info', message: '🤖 Initializing Gemini API...' });
     
     let llm_response: string;
     try {
       const { GoogleGenerativeAI } = await import('@google/generative-ai');
       const genAI = new GoogleGenerativeAI(apiKey);
       const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

       debugInfo.push({ type: 'info', message: '📡 Sending request to Gemini API...' });
       
       // Generate response
       const result = await model.generateContent(processedPrompt);
       const response = result.response;
       llm_response = response.text();
       
       debugInfo.push({ type: 'success', message: `✅ Response received (length: ${llm_response.length} characters)` });
     } catch (genError) {
       const errorMsg = genError instanceof Error ? genError.message : 'Unknown error';
       debugInfo.push({ type: 'error', message: `❌ Gemini API error: ${errorMsg}` });
       console.error('Gemini API error:', genError);
       throw genError;
     }

    const apiResponse = {
      llm_response,
      code: null,
      debug_info: debugInfo
    };

    return reply.send(apiResponse);
  } catch (error) {
    server.log.error('Error processing prompt:', error);
    console.error('Detailed error:', error);
    return reply.status(500).send({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Health check endpoint
server.get('/api/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Start the server
const start = async () => {
  try {
    const port = 3002; // Use a different port to avoid conflicts
    await server.listen({ port, host: '0.0.0.0' });
    server.log.info(`🚀 Server listening on http://localhost:${port}`);
    server.log.info('📁 Serving static files from public directory');
    server.log.info('🔗 API endpoints available at /api/prompt and /api/health');
    server.log.info('✨ @ commands supported - reference files with @filename or @folder/');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
