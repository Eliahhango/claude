import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const config = {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-3-opus-20240229', // Example: Opus
    // You might also need ANTHROPIC_API_URL if using a proxy or non-standard endpoint

    commandPrefix: process.env.COMMAND_PREFIX || '!' // Prefix for bot commands
};

// Basic validation for Anthropic Key
if (!config.anthropicApiKey) {
    console.error('Error: ANTHROPIC_API_KEY is not set in the .env file.');
    console.error('Please create a .env file and add your Anthropic API key.');
    console.error('Example .env file content: ANTHROPIC_API_KEY=your_api_key_here');
    process.exit(1); // Exit if API key is missing
}

export default config; 