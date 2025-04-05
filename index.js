import makeWASocket, {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
// import pino from 'pino'; // Remove direct import
import logger from './logger.js'; // Import shared logger
import config from './config.js';
// import { getChatCompletion } from './deepseek.js'; // Remove old AI import
import { getClaudeCompletion } from './claude.js'; // Import Claude AI function

// Basic logger setup - MOVED to logger.js
// const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Directory to store authentication state
// NOTE: On platforms like Heroku with ephemeral filesystems,
// this auth state might be lost on restarts/deploys, requiring a QR scan again.
// For more robust deployments, consider storing this state externally (e.g., database, Redis).
const AUTH_DIR = './auth_info_baileys';

// In-memory store for conversation history { [jid: string]: message[] }
const conversationHistory = {};
const MAX_HISTORY_LENGTH = 10; // Limit history to prevent excessive API usage

// In-memory store for chat-specific settings
// NOTE: These settings are lost on restart. For persistence, use a database.
const chatSettings = {};
// Example: chatSettings['jid@g.us'] = { aiEnabled: false, antiLinkEnabled: true, welcomeEnabled: true }

// --- Helper Functions ---
async function getGroupMetadata(sock, jid) {
    try {
        const metadata = await sock.groupMetadata(jid);
        return metadata;
    } catch (err) {
        logger.error({ err, jid }, "Error fetching group metadata");
        return null;
    }
}

function isGroupAdmin(groupMetadata, participantJid) {
    if (!groupMetadata?.participants) return false;
    const participant = groupMetadata.participants.find(p => p.id === participantJid);
    return participant?.admin === 'admin' || participant?.admin === 'superadmin';
}
// --- End Helper Functions ---

async function connectToWhatsApp() {
    // --- Authentication Setup ---
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    // fetch latest version of WA Web
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);
    // --- End Authentication Setup ---

    const sock = makeWASocket({
        version,
        logger: logger.child({ level: 'silent' }), // Use 'debug' for detailed Baileys logs
        printQRInTerminal: true,
        mobile: false,
        auth: {
            creds: state.creds,
            // caching makes the store faster to send/recv messages
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        generateHighQualityLinkPreview: true,
        shouldIgnoreJid: jid => jid?.endsWith('@broadcast'), // Ignore broadcast messages
        // implement other configuration options as needed
    });

    // --- Connection Events ---
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            logger.info('QR code generated, scan with WhatsApp!');
            // QR code will be printed in the terminal by printQRInTerminal: true
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            logger.error('Connection closed due to ', lastDisconnect?.error, ', reconnecting ', shouldReconnect);
            // reconnect if not logged out
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        }
        else if (connection === 'open') {
            logger.info('WhatsApp connection opened!');
        }
    });
    // --- End Connection Events ---

    // --- Save Credentials Event ---
    sock.ev.on('creds.update', saveCreds);
    // --- End Save Credentials Event ---

    // --- Group Participants Update Handler (Welcome Message) ---
    sock.ev.on('group-participants.update', async (update) => {
        logger.debug({ update }, 'group-participants.update event');
        const { id, participants, action } = update;
        const settings = chatSettings[id];

        if (settings?.welcomeEnabled && action === 'add' && participants.length > 0) {
            // Check if bot is still in the group (optional, but good practice)
            const metadata = await getGroupMetadata(sock, id);
            if (!metadata) return; // Failed to get metadata

            const botIsAdmin = isGroupAdmin(metadata, sock.user.id);
            if (!botIsAdmin) {
                 logger.warn({ jid: id }, 'Welcome message enabled, but bot is not admin.');
                 return;
            }

            // Simple welcome message for now
            // You could customize this further, e.g., mentioning users by pushname
            const mentions = participants.map(p => `@${p.split('@')[0]}`).join(' ');
            const welcomeMsg = `Welcome to the group, ${mentions}! 🎉`;
            try {
                 await sock.sendMessage(id, { text: welcomeMsg, mentions: participants });
                 logger.info({ jid: id, participants }, 'Sent welcome message.');
            } catch (err) {
                logger.error({ err, jid: id }, 'Failed to send welcome message');
            }
        }
        // Add logic for 'remove', 'promote', 'demote' if needed
    });
    // --- End Group Participants Update Handler ---

    // --- Message Handling (Refactored) ---
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return; // Ignore self/empty

        const remoteJid = msg.key.remoteJid;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || ''; // Ensure it's a string
        const senderJid = msg.key.participant || msg.key.remoteJid; // participant for groups, remoteJid for private
        const isGroup = remoteJid?.endsWith('@g.us');

        if (!remoteJid) {
            logger.info('Ignoring message without remoteJid');
            return;
        }

        // Ensure settings object exists for this chat
        if (!chatSettings[remoteJid]) {
            chatSettings[remoteJid] = { aiEnabled: false, antiLinkEnabled: false, welcomeEnabled: false, antiSpamEnabled: false };
        }
        const currentSettings = chatSettings[remoteJid];

        // --- Command Processing ---
        if (messageText.startsWith(config.commandPrefix)) {
            const [command, ...args] = messageText.slice(config.commandPrefix.length).trim().split(/\s+/);
            const commandLower = command.toLowerCase();
            let isAdmin = false;
            let groupMetadata = null;

            if (isGroup) {
                groupMetadata = await getGroupMetadata(sock, remoteJid);
                if (groupMetadata) {
                    isAdmin = isGroupAdmin(groupMetadata, senderJid);
                } else {
                    logger.warn({ jid: remoteJid }, 'Could not get group metadata for command check');
                    // Maybe reply that an error occurred?
                }
            }

            logger.info({ command: commandLower, args, remoteJid, senderJid, isAdmin }, 'Processing command');

            // --- Admin Commands (Require Group Admin) ---
            if (isGroup && !isAdmin) {
                 // Respond only if it looks like a known admin command they tried to use
                 const adminCommands = ['aion', 'aioff', 'antilink', 'welcome', 'antispam'];
                 if (adminCommands.includes(commandLower)) {
                    await sock.sendMessage(remoteJid, { text: 'Sorry, only group admins can use this command.' }, { quoted: msg });
                 }
                 return; // Non-admin cannot run admin commands
            }

            let replyText = 'Unknown command.'; // Default reply
            let settingChanged = false;

            switch (commandLower) {
                case 'aion':
                    if (!isGroup) {
                         replyText = 'AI is always enabled in private chat.';
                    } else if (!currentSettings.aiEnabled) {
                        currentSettings.aiEnabled = true;
                        settingChanged = true;
                        replyText = '🤖 AI chat enabled for this group.';
                    } else {
                        replyText = 'AI chat is already enabled.';
                    }
                    break;
                case 'aioff':
                     if (!isGroup) {
                         replyText = 'AI cannot be disabled in private chat.';
                    } else if (currentSettings.aiEnabled) {
                        currentSettings.aiEnabled = false;
                        settingChanged = true;
                        replyText = '🤖 AI chat disabled for this group.';
                    } else {
                         replyText = 'AI chat is already disabled.';
                    }
                    break;
                case 'antilink':
                    if (!isGroup) { replyText = 'This command is only for groups.'; break; }
                    if (args[0]?.toLowerCase() === 'on' && !currentSettings.antiLinkEnabled) {
                        currentSettings.antiLinkEnabled = true; settingChanged = true;
                        replyText = '🔗 Anti-link enabled. Messages with links will be deleted.';
                    } else if (args[0]?.toLowerCase() === 'off' && currentSettings.antiLinkEnabled) {
                         currentSettings.antiLinkEnabled = false; settingChanged = true;
                        replyText = '🔗 Anti-link disabled.';
                    } else {
                        replyText = `Anti-link is currently ${currentSettings.antiLinkEnabled ? 'ON' : 'OFF'}. Use '${config.commandPrefix}antilink on/off'.`;
                    }
                    break;
                 case 'welcome':
                    if (!isGroup) { replyText = 'This command is only for groups.'; break; }
                     if (args[0]?.toLowerCase() === 'on' && !currentSettings.welcomeEnabled) {
                        currentSettings.welcomeEnabled = true; settingChanged = true;
                        replyText = '👋 Welcome messages enabled.';
                    } else if (args[0]?.toLowerCase() === 'off' && currentSettings.welcomeEnabled) {
                         currentSettings.welcomeEnabled = false; settingChanged = true;
                        replyText = '👋 Welcome messages disabled.';
                    } else {
                        replyText = `Welcome messages are currently ${currentSettings.welcomeEnabled ? 'ON' : 'OFF'}. Use '${config.commandPrefix}welcome on/off'.`;
                    }
                    break;
                 case 'antispam': // Placeholder
                    if (!isGroup) { replyText = 'This command is only for groups.'; break; }
                     if (args[0]?.toLowerCase() === 'on' && !currentSettings.antiSpamEnabled) {
                        currentSettings.antiSpamEnabled = true; settingChanged = true;
                        replyText = '🛡️ Anti-spam enabled (basic, placeholder logic).';
                    } else if (args[0]?.toLowerCase() === 'off' && currentSettings.antiSpamEnabled) {
                         currentSettings.antiSpamEnabled = false; settingChanged = true;
                        replyText = '🛡️ Anti-spam disabled.';
                    } else {
                        replyText = `Anti-spam is currently ${currentSettings.antiSpamEnabled ? 'ON' : 'OFF'}. Use '${config.commandPrefix}antispam on/off'.`;
                    }
                    break;
                case 'groupinfo':
                    if (!isGroup) { replyText = 'This command only works in groups.'; break; }
                    if (!groupMetadata) { replyText = 'Could not fetch group info.'; break; }
                    replyText = `*Group Info:*
*Subject:* ${groupMetadata.subject}
*Participants:* ${groupMetadata.participants.length}`;
                    break;

                case 'setgroupsubject':
                    if (!isGroup) { replyText = 'This command only works in groups.'; break; }
                    if (!botIsAdmin) { replyText = 'I need to be an admin to change the group subject.'; break; } // Check if bot is admin
                    const newSubject = args.join(' ');
                    if (!newSubject) { replyText = 'Please provide a new subject.'; break; }
                    try {
                        await sock.groupUpdateSubject(remoteJid, newSubject);
                        replyText = 'Group subject updated successfully.';
                        logger.info({ jid: remoteJid, subject: newSubject }, 'Group subject updated');
                    } catch (err) {
                        logger.error({ err, jid: remoteJid }, 'Failed to update group subject');
                        replyText = 'Failed to update group subject.';
                    }
                    break;

                case 'sendimage':
                    const imageUrl = args[0];
                    if (!imageUrl) { replyText = 'Please provide a direct image URL.'; break; }
                    try {
                        // Basic URL validation (can be improved)
                        new URL(imageUrl);
                        logger.info({ jid: remoteJid, url: imageUrl }, 'Attempting to send image from URL');
                        await sock.sendMessage(remoteJid, { image: { url: imageUrl }, caption: args.slice(1).join(' ') || '' });
                        replyText = 'Image sent (if URL was valid and accessible).'; // Don't send explicit success text usually
                        // Set replyText to null or empty if you don't want a text confirmation
                        replyText = null; 
                    } catch (err) {
                        logger.error({ err, url: imageUrl }, 'Failed to send image from URL');
                        replyText = 'Failed to send image. Please ensure it is a direct, valid image URL.';
                    }
                    break;

                case 'leave':
                    if (!isGroup) { replyText = 'I can only leave groups.'; break; }
                    replyText = 'Okay, leaving this group.';
                    await sock.sendMessage(remoteJid, { text: replyText }); // Send message before leaving
                    try {
                        await sock.groupLeave(remoteJid);
                        logger.info({ jid: remoteJid }, 'Left group successfully');
                        // No further action possible in this chat after leaving
                         return; // Exit processing for this message
                    } catch (err) {
                        logger.error({ err, jid: remoteJid }, 'Failed to leave group');
                        // Cannot send message here as we might have already left or failed
                    }
                    break;
                
                case 'myinfo':
                     replyText = `My JID is: ${sock.user?.id}`;
                     break;

                case 'menu':
                case 'help': // Allow !help as an alias
                    const menuPrefix = config.commandPrefix;
                    let menuText = `*🤖 Claude Bot Menu*\n\n`;
                    menuText += `Use commands starting with \`${menuPrefix}\`\n\n`;
                    menuText += `*AI Chat:*\n`;
                    menuText += `💬 Responds to all messages in private chat.\n`;
                    if (isGroup) {
                        menuText += `   - Group AI: \`${currentSettings.aiEnabled ? 'ON' : 'OFF'}\`\n`;
                        menuText += `   - ${menuPrefix}aion - Enable AI in this group (Admin Only)\n`;
                        menuText += `   - ${menuPrefix}aioff - Disable AI in this group (Admin Only)\n\n`;
                    } else {
                        menuText += `   (Use \`!aion\` / \`!aioff\` in groups to control AI there)\n\n`;
                    }

                    menuText += `*Group Management (Admin Only):*\n`;
                    menuText += `🔗 Anti-Link: \`${currentSettings.antiLinkEnabled ? 'ON' : 'OFF'}\` (\`${menuPrefix}antilink on/off\`) \n`;
                    menuText += `👋 Welcome: \`${currentSettings.welcomeEnabled ? 'ON' : 'OFF'}\` (\`${menuPrefix}welcome on/off\`) \n`;
                    menuText += `🛡️ Anti-Spam: \`${currentSettings.antiSpamEnabled ? 'ON' : 'OFF'}\` (\`${menuPrefix}antispam on/off\`) \n\n`;

                    menuText += `*Other Commands:*\n`;
                    menuText += `   - ${menuPrefix}groupinfo - Show group details (Groups Only)\n`;
                    menuText += `   - ${menuPrefix}setgroupsubject <subject> - Change group name (Admin Only)\n`;
                    menuText += `   - ${menuPrefix}sendimage <url> - Send image from URL\n`;
                    menuText += `   - ${menuPrefix}leave - Make the bot leave the current group\n`;
                    menuText += `   - ${menuPrefix}myinfo - Show my WhatsApp ID\n`;
                    menuText += `   - ${menuPrefix}menu / ${menuPrefix}help - Show this menu\n`;

                    replyText = menuText;
                    break;

                // Add other commands here (e.g., help command)
                 default:
                    // Keep the default unknown command reply
                    replyText = 'Unknown command.'; 
            }

            if (replyText) { // Only send if there's something to say
                 if (settingChanged) {
                    logger.info({ jid: remoteJid, settings: currentSettings }, 'Chat settings updated.');
                    // Consider persisting settings here if using a database
                 }
                 await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
            }
            return; // Stop processing after a command
        }
        // --- End Command Processing ---


        // --- Regular Message Processing (Non-Command) ---
        logger.info(`Processing regular message from ${senderJid} in ${remoteJid}`);

        let messageDeleted = false;

        // --- Group Moderation ---
        if (isGroup) {
            const metadata = groupMetadata || await getGroupMetadata(sock, remoteJid);
            const senderIsAdmin = metadata ? isGroupAdmin(metadata, senderJid) : false;
            const botIsAdmin = metadata ? isGroupAdmin(metadata, sock.user.id) : false;

            // Anti-Link Check
            if (currentSettings.antiLinkEnabled && !senderIsAdmin) { // Admins are immune
                 const urlRegex = /((([A-Za-z]{3,9}:(?:\/\/)?)(?:[-;:&=\+\$,\w]+@)?[A-Za-z0-9.-]+|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w\-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[.\!\/\\w]*))?)/;
                 if (urlRegex.test(messageText)) {
                     logger.info({ jid: remoteJid, sender: senderJid }, 'Link detected, deleting message...');
                     if (botIsAdmin) {
                        try {
                            await sock.sendMessage(remoteJid, { delete: msg.key });
                            messageDeleted = true;
                             // Optionally remove the user - Be careful with this!
                             // await sock.groupParticipantsUpdate(remoteJid, [senderJid], "remove");
                             // await sock.sendMessage(remoteJid, { text: `@${senderJid.split('@')[0]} removed for sending links.` , mentions: [senderJid]});
                        } catch (err) {
                            logger.error({ err, jid: remoteJid }, 'Failed to delete link message or remove user');
                        }
                     } else {
                         logger.warn({ jid: remoteJid }, 'Link detected, but bot is not admin to delete.');
                         // Maybe notify admins?
                     }
                 }
            }

             // Anti-Spam Check (Basic Placeholder)
            if (!messageDeleted && currentSettings.antiSpamEnabled && !senderIsAdmin) {
                // Implement your spam detection logic here
                // Example: Check for very long messages, excessive emojis, repeated messages quickly, blacklisted words
                const isSpam = messageText.length > 1000; // Very basic example
                if (isSpam) {
                     logger.info({ jid: remoteJid, sender: senderJid }, 'Potential spam detected, deleting message...');
                      if (botIsAdmin) {
                        try {
                             await sock.sendMessage(remoteJid, { delete: msg.key });
                             messageDeleted = true;
                             // Optionally remove user
                             // await sock.groupParticipantsUpdate(remoteJid, [senderJid], "remove");
                             // await sock.sendMessage(remoteJid, { text: `@${senderJid.split('@')[0]} removed for spam.` , mentions: [senderJid]});
                        } catch (err) {
                             logger.error({ err, jid: remoteJid }, 'Failed to delete spam message or remove user');
                        }
                     } else {
                          logger.warn({ jid: remoteJid }, 'Spam detected, but bot is not admin to delete.');
                     }
                }
            }
        }
        // --- End Group Moderation ---

        if (messageDeleted) {
            logger.info({ jid: remoteJid, sender: senderJid }, 'Message was deleted, skipping AI processing.');
            return; // Don't process deleted messages with AI
        }

        // --- AI Response Logic ---
        const shouldRespondWithAI = !isGroup || currentSettings.aiEnabled;

        if (shouldRespondWithAI) {
            logger.info({ jid: remoteJid }, 'Processing message with AI...');
            try {
                // Initialize history if it doesn't exist (should already be done, but safety check)
                if (!conversationHistory[remoteJid]) {
                    conversationHistory[remoteJid] = [];
                }

                // Append user message to history
                conversationHistory[remoteJid].push({ role: 'user', content: messageText });

                // Trim history logic (keeping the improved version)
                const history = conversationHistory[remoteJid];
                const systemMessage = history[0]?.role === 'system' ? history[0] : null;
                let startIndex = history.length > MAX_HISTORY_LENGTH ? history.length - MAX_HISTORY_LENGTH : 0;
                if (systemMessage && startIndex === 0 && history.length > MAX_HISTORY_LENGTH) {
                    startIndex = 1;
                }
                const messagesForApi = systemMessage
                    ? [systemMessage, ...history.slice(startIndex)]
                    : history.slice(startIndex);

                // Update conversation history *before* API call in this version
                conversationHistory[remoteJid] = messagesForApi;

                // Indicate typing
                await sock.sendPresenceUpdate('composing', remoteJid);

                // Get response from Claude
                const claudeResponse = await getClaudeCompletion(messagesForApi); // Changed variable name

                // Stop typing indicator
                await sock.sendPresenceUpdate('paused', remoteJid);

                // Append assistant response to history & send
                if (claudeResponse && claudeResponse.content) {
                     // Add response to the original full history array
                    history.push(claudeResponse);
                    // Trim again if needed after adding response
                    const updatedHistory = conversationHistory[remoteJid];
                    const updatedSystemMessage = updatedHistory[0]?.role === 'system' ? updatedHistory[0] : null;
                    let updatedStartIndex = updatedHistory.length > MAX_HISTORY_LENGTH ? updatedHistory.length - MAX_HISTORY_LENGTH : 0;
                    if (updatedSystemMessage && updatedStartIndex === 0 && updatedHistory.length > MAX_HISTORY_LENGTH) {
                        updatedStartIndex = 1;
                    }
                    conversationHistory[remoteJid] = updatedSystemMessage
                        ? [updatedSystemMessage, ...updatedHistory.slice(updatedStartIndex)]
                        : updatedHistory.slice(updatedStartIndex);

                    // Send Claude response back to WhatsApp
                    logger.info(`Sending Claude response to ${remoteJid}: "${claudeResponse.content}"`);
                    await sock.sendMessage(remoteJid, { text: claudeResponse.content });
                } else {
                    logger.error('Received empty or invalid response from Claude');
                    await sock.sendMessage(remoteJid, { text: "Sorry, I couldn't get a response from the AI right now." });
                }

            } catch (aiError) {
                logger.error({ err: aiError, jid: remoteJid }, 'Error during AI processing');
                 try { await sock.sendPresenceUpdate('paused', remoteJid); } catch (e) { /* ignore */ }
                 try {
                     await sock.sendMessage(remoteJid, { text: 'Sorry, an error occurred while processing the AI response.' });
                 } catch (sendError) {
                     logger.error({ err: sendError, jid: remoteJid }, 'Failed to send AI error message to user');
                 }
            }
        } else {
            logger.info({ jid: remoteJid, isGroup, aiEnabled: currentSettings.aiEnabled }, 'AI response skipped based on chat type/settings.');
        }
        // --- End AI Response Logic ---

    });
    // --- End Message Handling ---

    return sock;
}

// Start the connection process
connectToWhatsApp().catch(err => logger.error("Failed to connect to WhatsApp:", err)); 