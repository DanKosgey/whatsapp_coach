const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const GRAPH_API_URL = process.env.WHATSAPP_GRAPH_API_URL || 'https://graph.facebook.com';
const API_VERSION = process.env.WHATSAPP_GRAPH_API_VERSION || 'v21.0';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

/**
 * Send a text message via WhatsApp Business API
 * @param {string} recipientPhone - Phone number in international format (e.g., "1234567890")
 * @param {string} messageText - The text message to send
 * @returns {Promise<object>} - Response from Meta API
 */
async function sendTextMessage(recipientPhone, messageText) {
    try {
        const url = `${GRAPH_API_URL}/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientPhone,
            type: 'text',
            text: {
                preview_url: false,
                body: messageText
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ Message sent to ${recipientPhone}:`, response.data);
        return response.data;

    } catch (error) {
        console.error('❌ Error sending WhatsApp message:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Send an interactive message with buttons
 * @param {string} recipientPhone - Phone number
 * @param {string} bodyText - Main message text
 * @param {array} buttons - Array of button objects [{id: 'btn1', title: 'Button 1'}]
 * @returns {Promise<object>}
 */
async function sendInteractiveButtons(recipientPhone, bodyText, buttons) {
    try {
        const url = `${GRAPH_API_URL}/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

        // Format buttons for WhatsApp (max 3 buttons)
        const formattedButtons = buttons.slice(0, 3).map(btn => ({
            type: 'reply',
            reply: {
                id: btn.id,
                title: btn.title.substring(0, 20) // Max 20 chars
            }
        }));

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientPhone,
            type: 'interactive',
            interactive: {
                type: 'button',
                body: {
                    text: bodyText
                },
                action: {
                    buttons: formattedButtons
                }
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ Interactive message sent to ${recipientPhone}`);
        return response.data;

    } catch (error) {
        console.error('❌ Error sending interactive message:', error.response?.data || error.message);
        // Fallback to regular text message
        return sendTextMessage(recipientPhone, bodyText);
    }
}

/**
 * Send a message with a list
 * @param {string} recipientPhone - Phone number
 * @param {string} bodyText - Main message text
 * @param {string} buttonText - Text for the list button
 * @param {array} sections - Array of section objects with rows
 * @returns {Promise<object>}
 */
async function sendInteractiveList(recipientPhone, bodyText, buttonText, sections) {
    try {
        const url = `${GRAPH_API_URL}/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientPhone,
            type: 'interactive',
            interactive: {
                type: 'list',
                body: {
                    text: bodyText
                },
                action: {
                    button: buttonText,
                    sections: sections
                }
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ List message sent to ${recipientPhone}`);
        return response.data;

    } catch (error) {
        console.error('❌ Error sending list message:', error.response?.data || error.message);
        return sendTextMessage(recipientPhone, bodyText);
    }
}

/**
 * Send a template message (requires pre-approved templates)
 * @param {string} recipientPhone - Phone number
 * @param {string} templateName - Name of approved template
 * @param {string} languageCode - Language code (e.g., 'en', 'en_US')
 * @param {array} components - Template components (optional)
 * @returns {Promise<object>}
 */
async function sendTemplate(recipientPhone, templateName, languageCode = 'en', components = []) {
    try {
        const url = `${GRAPH_API_URL}/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

        const payload = {
            messaging_product: 'whatsapp',
            to: recipientPhone,
            type: 'template',
            template: {
                name: templateName,
                language: {
                    code: languageCode
                },
                components: components
            }
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        console.log(`✅ Template sent to ${recipientPhone}`);
        return response.data;

    } catch (error) {
        console.error('❌ Error sending template:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Mark a message as read
 * @param {string} messageId - WhatsApp message ID
 * @returns {Promise<object>}
 */
async function markMessageAsRead(messageId) {
    try {
        const url = `${GRAPH_API_URL}/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

        const payload = {
            messaging_product: 'whatsapp',
            status: 'read',
            message_id: messageId
        };

        const response = await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;

    } catch (error) {
        console.error('❌ Error marking message as read:', error.response?.data || error.message);
        throw error;
    }
}

/**
 * Verify webhook signature from Meta
 * @param {string} signature - X-Hub-Signature-256 header
 * @param {string} body - Raw request body
 * @returns {boolean}
 */
function verifyWebhookSignature(signature, body) {
    // Meta uses HMAC SHA256 for webhook verification
    const hmac = crypto.createHmac('sha256', process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN);
    const digest = 'sha256=' + hmac.update(body).digest('hex');

    return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(digest)
    );
}

/**
 * Parse incoming webhook message
 * @param {object} webhookData - Webhook payload from Meta
 * @returns {object|null} - Parsed message data or null
 */
function parseIncomingMessage(webhookData) {
    try {
        // Structure: webhookData.entry[0].changes[0].value.messages[0]
        const entry = webhookData.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;

        if (!value || !value.messages || value.messages.length === 0) {
            return null; // No messages to process
        }

        const message = value.messages[0];
        const contact = value.contacts?.[0];

        return {
            messageId: message.id,
            from: message.from, // Phone number
            timestamp: message.timestamp,
            type: message.type, // 'text', 'button', 'interactive', 'image', etc.
            text: message.text?.body || '',
            buttonReply: message.button?.text || null,
            listReply: message.interactive?.list_reply || null,
            contactName: contact?.profile?.name || '',
            metadata: value.metadata
        };

    } catch (error) {
        console.error('Error parsing webhook message:', error);
        return null;
    }
}

module.exports = {
    sendTextMessage,
    sendInteractiveButtons,
    sendInteractiveList,
    sendTemplate,
    markMessageAsRead,
    verifyWebhookSignature,
    parseIncomingMessage
};
