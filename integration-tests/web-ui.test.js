/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { test } from 'node:test';
import { strict as assert } from 'assert';
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import treeKill from 'tree-kill';

test('should display a mock response in the web UI', async (t) => {
  // Start the web server
  const server = spawn('npm', ['run', 'start:web'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    shell: true,
  });

  let serverReady = false;
  let serverOutput = '';

  const serverReadyPromise = new Promise((resolve, reject) => {
    server.stdout.on('data', (data) => {
      serverOutput += data.toString();
      if (!serverReady && serverOutput.includes('Server listening on')) {
        serverReady = true;
        resolve();
      }
    });

    server.stderr.on('data', (data) => {
      console.error(`server stderr: ${data}`);
      reject(new Error(`Server failed to start: ${data}`));
    });

    server.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Server process exited with code ${code}`));
      }
    });
  });

  try {
    await serverReadyPromise;

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('http://localhost:3000');

    const promptText = 'what planet do we live on';
    await page.locator('#promptInput').fill(promptText);
    await page.locator('#submitPrompt').click();

    const responseLocator = page.locator('.llm-response');
    await responseLocator.waitFor({ state: 'visible' });
    const responseText = await responseLocator.textContent();

    assert.ok(responseText);
    assert.ok(!responseText.includes(`Mock response for: "${promptText}"`));

    await browser.close();
  } finally {
    // Kill the server process
    if (server.pid) {
      treeKill(server.pid);
    }
  }
}); 