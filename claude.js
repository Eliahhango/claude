import Anthropic from '@anthropic-ai/sdk';
import config from './config.js';
import logger from './logger.js'; // Assuming we'll create a logger utility

// Initialize Anthropic client
let anthropic;
try {
    anthropic = new Anthropic({
        apiKey: config.anthropicApiKey,
        // baseURL: process.env.ANTHROPIC_API_URL, // Optional: if using proxy
    });
} catch (error) {
    logger.error({ err: error }, 'Failed to initialize Anthropic SDK. Check API key and SDK installation.');
    // Exit or handle gracefully - perhaps disable AI features
    process.exit(1);
}

// Function to get a chat completion from Claude
// messages should be an array like [{ role: 'user'/'assistant', content: '...' }]
// systemPrompt is an optional string for system instructions
async function getClaudeCompletion(messages, systemPrompt = '') {
    if (!anthropic) {
        logger.error('Anthropic SDK not initialized.');
        return { role: 'assistant', content: 'Sorry, the AI module is not initialized.' };
    }

    // Claude API expects messages in a slightly different format for history
    // and needs the system prompt separated.
    // It also requires alternating user/assistant roles strictly.

    // Filter out system message from history if it exists
    const history = messages.filter(m => m.role !== 'system');

    // Ensure alternating roles, starting with user. Remove leading assistant messages if any.
    const firstUserIndex = history.findIndex(m => m.role === 'user');
    const cleanedHistory = firstUserIndex !== -1 ? history.slice(firstUserIndex) : [];

    // Ensure the last message is from the user (Claude requires this)
    if (cleanedHistory.length === 0 || cleanedHistory[cleanedHistory.length - 1].role !== 'user') {
         logger.warn({ history: cleanedHistory }, 'History for Claude API call doesn\'t end with a user message. Skipping call.');
         // This might happen if the bot sends multiple messages or processing fails.
         return null; // Indicate no response can be generated
    }

    // Find an existing system prompt in messages or use the provided one
    const system = messages.find(m => m.role === 'system')?.content || systemPrompt;

    try {
        logger.info({ model: config.anthropicModel, historyLength: cleanedHistory.length, system: !!system }, 'Sending request to Claude API...');

        const response = await anthropic.messages.create({
            model: config.anthropicModel,
            max_tokens: 1024, // Adjust as needed
            system: system || undefined, // Only include system if it exists
            messages: cleanedHistory, // Send the cleaned history
        });

        // Log the full response for debugging (optional)
        // logger.debug({ response }, 'Claude API Response:');

        if (response && response.content && response.content.length > 0 && response.content[0].type === 'text') {
            const replyText = response.content[0].text;
            logger.info('Received reply from Claude.');
            return { role: 'assistant', content: replyText }; // Return the assistant message object
        } else {
            logger.error({ response }, 'Invalid response format from Claude API.');
            return { role: 'assistant', content: 'Sorry, I received an unexpected response from the AI.' };
        }

    } catch (error) {
        logger.error({ err: error }, 'Error calling Claude API');
        // You could check error.status or error.code for specific issues like rate limits, auth errors etc.
        let userMessage = 'Sorry, I encountered an error trying to reach the AI.';
        if (error instanceof Anthropic.APIError) {
            logger.error({ status: error.status, type: error.error?.type }, 'Anthropic API Error Details');
            if (error.status === 401 || error.status === 403) {
                userMessage = 'AI API authentication failed. Please check the API key.';
            } else if (error.status === 429) {
                userMessage = 'AI rate limit reached. Please try again later.';
            }
        }
        return { role: 'assistant', content: userMessage };
    }
}

export { getClaudeCompletion }; 