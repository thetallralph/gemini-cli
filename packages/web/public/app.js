document.addEventListener('DOMContentLoaded', () => {
    const promptInput = document.getElementById('promptInput');
    const submitPromptBtn = document.getElementById('submitPrompt');
    const responseArea = document.getElementById('responseArea');
    const codeInputPlaceholder = document.getElementById('codeInputPlaceholder');
    const sendToLLMBtn = document.getElementById('sendToLLMBtn');
    const applyCodeChangesBtn = document.getElementById('applyCodeChangesBtn'); // Added for future use

    let codeEditor;

    // Initialize CodeMirror
    if (codeInputPlaceholder) {
        codeEditor = CodeMirror.fromTextArea(codeInputPlaceholder, {
            lineNumbers: true,
            mode: "javascript", // Default mode, can be changed dynamically
            theme: "material-darker",
            matchBrackets: true,
            autoCloseBrackets: true,
        });
    } else {
        console.error("CodeMirror placeholder textarea not found!");
    }

    // Function to append messages to the chat area
    function appendMessage(text, className, isHtml = false) {
        const messageElement = document.createElement('div'); // Use div for more flexibility
        if (isHtml) {
            messageElement.innerHTML = text;
        } else {
            messageElement.textContent = text;
        }
        messageElement.className = className;
        responseArea.appendChild(messageElement);
        responseArea.scrollTop = responseArea.scrollHeight; // Scroll to bottom
    }

    // Remove welcome message if user starts typing in prompt
    if (promptInput) {
        promptInput.addEventListener('focus', () => {
            const welcomeMsg = responseArea.querySelector('.server-message');
            if (welcomeMsg && welcomeMsg.textContent.includes('Welcome!')) {
                // welcomeMsg.remove(); // Or hide
            }
        }, { once: true });
    }

    async function handlePromptSubmission(promptText, context) {
        if (!promptText) return;

        appendMessage(`<strong>You (${context}):</strong><br>${promptText.replace(/\n/g, '<br>')}`, 'user-prompt', true);
        if (context === "Prompt") {
            promptInput.value = ''; // Clear the input only if it came from main prompt
        }

        try {
            const response = await fetch('/api/prompt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ prompt: promptText }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || data.details || `HTTP error! status: ${response.status}`);
            }

            let llmResponseText = data.llm_response || "No specific LLM response found.";
            appendMessage(`<strong>Gemini:</strong><br>${llmResponseText.replace(/\n/g, '<br>')}`, 'llm-response', true);

            if (data.code && codeEditor) {
                appendMessage("<em>LLM provided code. It has been placed in the editor.</em>", "server-message");
                codeEditor.setValue(data.code);
                // Potentially show "Apply Code Changes" button if applicable
                // applyCodeChangesBtn.style.display = 'inline-block';
            }

        } catch (error) {
            console.error('Error sending prompt:', error);
            appendMessage(`<strong>Error:</strong> ${error.message}`, 'error-message', true);
        }
    }

    if (submitPromptBtn) {
        submitPromptBtn.addEventListener('click', () => {
            handlePromptSubmission(promptInput.value.trim(), "Prompt");
        });
    }

    if (sendToLLMBtn && codeEditor) {
        sendToLLMBtn.addEventListener('click', () => {
            const code = codeEditor.getValue();
            if (!code.trim()) {
                alert("Code editor is empty. Please add some code or a request related to code.");
                return;
            }
            // You can choose to send only the code, or code + a prefix/prompt
            // For now, let's assume the user might have a prompt *about* the code in the main input,
            // or we can create a specific prompt format.
            // Simplest: send the code as the main part of the prompt.
            // A more advanced version could combine this with text from promptInput.

            let combinedPrompt = "";
            const mainPromptText = promptInput.value.trim();

            if (mainPromptText) {
                combinedPrompt = `Regarding the following code:\n\n\`\`\`\n${code}\n\`\`\`\n\n${mainPromptText}`;
                appendMessage("<em>Sending code from editor and text from prompt area to LLM...</em>", "server-message");
            } else {
                combinedPrompt = `Analyze the following code:\n\n\`\`\`\n${code}\n\`\`\`\n\nWhat can you tell me about it? Or, what improvements can be made?`;
                 appendMessage("<em>Sending code from editor to LLM...</em>", "server-message");
            }
            handlePromptSubmission(combinedPrompt, "Code Editor");
        });
    }

    // Placeholder for applyCodeChangesBtn functionality (e.g., sending code to a specific tool)
    if (applyCodeChangesBtn) {
        applyCodeChangesBtn.addEventListener('click', () => {
            alert("Apply Code Changes button clicked - functionality not yet implemented.");
            // Here you would get codeEditor.getValue() and send it to a backend endpoint
            // that uses a file writing or editing tool.
        });
    }
});
