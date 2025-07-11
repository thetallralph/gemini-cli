# Gemini Web UI

This package provides a web-based user interface for interacting with the Gemini model, allowing for chat and code interaction through a browser.

## Prerequisites

1.  **Node.js and npm:** Ensure you have Node.js (version specified in the root `package.json`'s `engines` field, e.g., >=20.0.0) and npm installed.
2.  **Project Setup:** From the root of the `gemini-cli` monorepo, run `npm install` to install all dependencies for all workspaces, including this one.
3.  **Gemini API Key (Recommended):** For the server to connect to the Gemini API and provide live responses, you need to set the `GEMINI_API_KEY` environment variable.
    ```bash
    export GEMINI_API_KEY="YOUR_API_KEY_HERE"
    ```
    If this is not set, the server will attempt to initialize the connection, but API calls will likely fail, and you may only see error messages or limited functionality from the backend.

## Running the Web UI

1.  **From the root of the monorepo:**
    ```bash
    npm run start:web
    ```
    This command uses `tsx` to run the TypeScript server directly and includes live reloading.

2.  **Alternatively, from the `packages/web` directory:**
    ```bash
    npm start
    # or
    npm run dev
    ```

3.  Once the server is running (it will log a message like "Server listening on http://localhost:3000"), open your web browser and navigate to:
    [http://localhost:3000](http://localhost:3000)

## Features

*   Chat with the Gemini model.
*   View and edit code in an embedded CodeMirror editor.
*   Send code from the editor to the LLM for analysis, explanation, or modification requests.
*   (Future) Apply code changes suggested by the LLM directly to local files (requires tool integration).

## Notes

*   **Configuration:** The web server currently uses a simplified, mocked configuration loading mechanism for settings and extensions that would normally be read from `.gemini/settings.json` or similar files by the CLI. Full integration with the CLI's advanced configuration system is a future enhancement.
*   **Code from LLM:** The feature for the LLM to provide code that automatically populates the editor depends on the backend explicitly sending a `code` field in its JSON response. The current live LLM interaction in `server.ts` does not yet robustly extract code from general text responses into this field.
*   **Error Handling:** If you encounter issues, check the server logs in your terminal for error messages, especially related to API key authentication or Gemini configuration initialization.

## Development

*   The server source code is in `packages/web/src/server.ts`.
*   Static frontend assets (HTML, CSS, client-side JS) are in `packages/web/public/`.
*   The server uses `Fastify` as the web framework.
*   Client-side code uses vanilla JavaScript and CodeMirror for the editor.
*   `tsx` is used for running the TypeScript server in development with live reload.
```
