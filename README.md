# Claude WhatsApp Bot

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

<!-- Optional: Add a logo here -->
<!-- ![Bot Logo](path/to/your/logo.png) -->

This project is a WhatsApp chatbot powered by the Anthropic Claude AI API, built using Node.js and the Baileys library. It includes group management features.

<!-- Optional: Add Deploy Button -->
[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/Eliahhango/claude) 

<!-- Optional: Add a GIF/Screenshot demonstration here -->
<!-- ![Bot Demo GIF](path/to/your/demo.gif) -->

---

## Features

*   Connects to WhatsApp using Baileys multi-device authentication.
*   Listens for incoming text messages.
*   **AI Chat:** Uses the Anthropic Claude API to generate context-aware responses.
    *   Responds in private chats by default.
    *   Can be enabled/disabled per group using commands.
*   **Group Management:**
    *   **Welcome Messages:** Automatically welcomes new members (requires admin privileges, toggleable per group).
    *   **Anti-Link:** Automatically deletes messages containing links sent by non-admins (requires admin privileges, toggleable per group).
    *   **Anti-Spam:** Basic placeholder for deleting spam messages from non-admins (requires admin privileges, toggleable per group).
    *   *Optional:* User removal for link/spam violations (commented out in code).
*   Maintains conversation history per chat (in-memory) for AI context.
*   Configurable command prefix.
*   Prepared for deployment on Heroku.

---

## Prerequisites

*   **Node.js:** v18.0.0 or higher
*   **npm:** Package manager for Node.js
*   **Git:** For cloning.
*   **Anthropic (Claude) API Key:** You need an API key from [Anthropic](https://console.anthropic.com/).
*   **WhatsApp Account:** To link the bot to.
*   **Heroku Account & CLI:** (Optional, for deployment).

---

## Configuration

Environment variables required:

*   `ANTHROPIC_API_KEY`: **Required.** Your API key for Anthropic.
*   `ANTHROPIC_MODEL`: (Optional) The Claude model name (e.g., `claude-3-opus-20240229`, `claude-3-sonnet-20240229`, `claude-3-haiku-20240307`). Defaults to Opus.
*   `COMMAND_PREFIX`: (Optional) Prefix for commands. Defaults to `!`.
*   `LOG_LEVEL`: (Optional) Logging level (`info`, `debug`, `silent`). Defaults to `info`.
*   `SESSION_ID`: (Optional/Required depending on setup) Your Baileys session ID string for authentication.

---

## Commands (Group Admin Only)

Use these commands in a group where the bot is an admin:

*   `!aion`: Enables AI responses in this group.
*   `!aioff`: Disables AI responses in this group (default).
*   `!antilink on`: Enables anti-link protection.
*   `!antilink off`: Disables anti-link protection.
*   `!welcome on`: Enables welcome messages for new members.
*   `!welcome off`: Disables welcome messages.
*   `!antispam on`: Enables basic anti-spam protection (placeholder logic).
*   `!antispam off`: Disables anti-spam protection.

> *(Note: Command prefix `!` is configurable via `COMMAND_PREFIX` env var)*

---

## Local Setup

1.  **Clone:**
    ```bash
    git clone https://github.com/Eliahhango/claude.git && cd claude
    ```
2.  **Install:**
    ```bash
    npm install
    ```
3.  **Create `.env` file:** Add your API key and Session ID:
    ```dotenv
    ANTHROPIC_API_KEY=your_key_here
    SESSION_ID=your_baileys_session_id_here # Required if not scanning QR
    ```
4.  **Run:**
    ```bash
    npm start
    ```
5.  **(Optional) Scan QR Code:** If `SESSION_ID` is *not* set in `.env`, a QR code will appear on first run. Scan with WhatsApp (Settings > Linked Devices).
6.  **Test:** Send messages, use commands.

---

## Deployment

This bot can be deployed to various platforms. Remember to configure `ANTHROPIC_API_KEY` and `SESSION_ID`.

**Key Considerations for All Platforms:**

*   **Environment Variables:** Set `ANTHROPIC_API_KEY`, `SESSION_ID`, and other optional variables through the platform's dashboard or CLI.
*   **Chat Settings Persistence:** The per-chat settings (AI enabled, anti-link, etc.) are stored in memory and will be lost on restarts/redeploys. Consider external storage (Database/Redis) for persistence.
*   **Process Type:** Ensure the platform runs the bot as a background worker (`node index.js` or `npm start`).

### Deployment to Heroku

Click the button below for easy deployment (requires a Heroku account):

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/Eliahhango/claude)

Or, follow the manual steps:

1.  **Login:** `heroku login`
2.  **Create:** `heroku create your-app-name`
3.  **Set Config Vars:**
    ```bash
    heroku config:set ANTHROPIC_API_KEY=your_actual_anthropic_key_here
    heroku config:set SESSION_ID=your_actual_session_id_here
    # Optional:
    # heroku config:set ANTHROPIC_MODEL=claude-3-sonnet-20240229
    # heroku config:set COMMAND_PREFIX=@
    ```
4.  **Deploy:**
    ```bash
    git add .
    git commit -m "Ready for Heroku deployment"
    git push heroku main
    ```
5.  **Scale Worker:** `heroku ps:scale worker=1`.
6.  **Check Logs:** `heroku logs --tail`. (No QR scan needed if SESSION_ID is set).

### Deployment to Render

Render offers background worker services, often with a free tier.

1.  **Sign up/Login:** [Render](https://render.com/)
2.  **Create Service:** Create a new "Background Worker" service.
3.  **Connect Repository:** Connect your GitHub repository (`Eliahhango/claude`).
4.  **Configure:**
    *   **Runtime:** Node
    *   **Build Command:** `npm install` (usually default)
    *   **Start Command:** `node index.js`
5.  **Environment Variables:** Add `ANTHROPIC_API_KEY`, `SESSION_ID`, and others under the "Environment" section.
6.  **Deploy:** Create the service. Render will build and deploy.
7.  **Check Logs:** View logs from the Render dashboard. (No QR scan needed if SESSION_ID is set).

### Deployment to Railway

Railway uses a usage-based model, often with a free starter plan.

1.  **Sign up/Login:** [Railway](https://railway.app/)
2.  **Create Project:** Start a new project, deploying from your GitHub repo.
3.  **Configure:** Railway often automatically detects Node.js and uses `npm start`. You might need to ensure it doesn't try to deploy as a web service (check deployment settings).
4.  **Environment Variables:** Add `ANTHROPIC_API_KEY`, `SESSION_ID`, and others in the "Variables" section.
5.  **Deploy:** Commits to your main branch usually trigger deployments.
6.  **Check Logs:** View logs from the Railway dashboard. (No QR scan needed if SESSION_ID is set).

### Deployment to Fly.io

Fly.io provides a platform for deploying applications globally, often with a free tier.

1.  **Sign up/Install CLI:** [Fly.io](https://fly.io/) and install the `flyctl` CLI.
2.  **Login:** `flyctl auth login`
3.  **Launch:** Run `flyctl launch` in your project directory. It will detect Node.js and ask configuration questions.
    *   Choose a unique app name and region.
    *   It might generate a `fly.toml` file.
    *   **Crucially:** Ensure it sets up a background service, not a web server exposing ports. You might need to edit `fly.toml` - remove any `[[services]]` section exposing HTTP and ensure the `[processes]` (or similar) section correctly defines a command like `npm start` or `node index.js` for a default or app process.
4.  **Set Secrets:** Use `flyctl secrets set` for environment variables:
    ```bash
    flyctl secrets set ANTHROPIC_API_KEY=your_actual_anthropic_key_here
    flyctl secrets set SESSION_ID=your_actual_session_id_here
    # flyctl secrets set ANTHROPIC_MODEL=...
    ```
5.  **Deploy:** `flyctl deploy`
6.  **Check Logs:** `flyctl logs`. (No QR scan needed if SESSION_ID is set).

> **Important Note on Chat Settings Persistence:** The per-chat settings (like `aiEnabled`, `antiLinkEnabled`) are stored in memory and **will be lost** on restarts/redeploys. For production use, external storage (Database, Redis) is recommended.

---

## How it Works (Updated)

1.  **Connection:** Connects to WhatsApp via Baileys.
2.  **Listening:** Listens for messages and group member changes.
3.  **Commands:** Parses messages starting with the prefix to toggle features per group (admins only).
4.  **Moderation:** If enabled for a group, checks non-admin messages for links or spam, deletes them, and potentially removes the user (requires bot admin).
5.  **Welcome:** If enabled, welcomes new members.
6.  **AI:** Responds to private messages or messages in groups where AI is enabled, using Claude with conversation history. 