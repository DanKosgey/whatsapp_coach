const express = require('express');
const whatsapp = require('./whatsapp-meta');
const db = require('./db');
const nlp = require('./nlp');
const aiAgent = require('./ai-agent');
require('dotenv').config();

const router = express.Router();

/**
 * GET /webhook - Webhook verification endpoint
 * Meta will call this to verify your webhook URL
 */
router.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    console.log('📞 Webhook verification request received');

    // Check if token matches
    if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
        console.log('✅ Webhook verified successfully');
        res.status(200).send(challenge);
    } else {
        console.log('❌ Webhook verification failed');
        res.sendStatus(403);
    }
});

/**
 * POST /webhook - Handle incoming messages from WhatsApp
 */
router.post('/webhook', async (req, res) => {
    try {
        // Immediately respond 200 to Meta (required within 20 seconds)
        res.sendStatus(200);

        const webhookData = req.body;

        // Verify this is a WhatsApp message event
        if (webhookData.object !== 'whatsapp_business_account') {
            console.log('Not a WhatsApp event, ignoring');
            return;
        }

        // Parse the incoming message
        const messageData = whatsapp.parseIncomingMessage(webhookData);

        if (!messageData) {
            console.log('No message to process');
            return;
        }

        console.log('📩 Incoming message:', messageData);

        // Mark message as read
        await whatsapp.markMessageAsRead(messageData.messageId);

        // Process the message asynchronously
        await handleIncomingMessage(messageData);

    } catch (error) {
        console.error('❌ Error processing webhook:', error);
    }
});

/**
 * Handle incoming WhatsApp message
 */
async function handleIncomingMessage(messageData) {
    try {
        const { from, text, contactName, messageId } = messageData;

        // Get or create user
        let user = await db.getUserByWhatsApp(from);

        if (!user) {
            console.log(`New user detected: ${from}`);
            user = await db.createUser(from, contactName);

            // Send welcome message
            await whatsapp.sendTextMessage(
                from,
                `Hey ${contactName || 'there'}! 👋 Welcome to your celibacy journey tracker.\n\nI'm here to support you every step of the way. Let's start with a quick check-in!\n\nHow are you feeling today? (1-10)`
            );
            return;
        }

        // Save user message to conversation history
        await db.saveConversation(
            user.user_id,
            'user',
            text,
            'casual',
            null,
            messageId
        );

        // Analyze message sentiment and extract metrics
        const analysis = nlp.analyzeMessage(text);

        // Save to daily logs
        await db.saveDailyLog(user.user_id, analysis);

        // Check for special intents
        const isRelapse = await aiAgent.detectRelapseIntent(text);
        const isWin = await aiAgent.detectWinIntent(text);

        let messageType = 'casual';

        if (isRelapse) {
            messageType = 'emergency';
            // Log relapse event
            await db.logEvent(
                user.user_id,
                'relapse',
                -50, // Energy impact
                text,
                analysis.triggers_mentioned
            );

            // Deduct energy and reset streak
            await db.addEnergyTransaction(
                user.user_id,
                -50,
                'relapse',
                'Energy deduction from relapse'
            );

            await db.updateUserStreak(user.user_id, 0);

        } else if (isWin) {
            messageType = 'celebration';
            // Log win event
            await db.logEvent(
                user.user_id,
                'major_win',
                20,
                text,
                []
            );

            // Add energy bonus
            await db.addEnergyTransaction(
                user.user_id,
                20,
                'achievement',
                'Energy bonus for achievement'
            );
        }

        // Generate AI response using Claude
        const aiResponse = await aiAgent.generateAIResponse(
            user.user_id,
            text,
            messageType
        );

        // Send response via WhatsApp
        await whatsapp.sendTextMessage(from, aiResponse);

        console.log(`✅ Processed message from ${from}`);

    } catch (error) {
        console.error('Error handling message:', error);

        // Send error message to user
        try {
            await whatsapp.sendTextMessage(
                messageData.from,
                "I'm having trouble processing that right now. Can you try again? 🙏"
            );
        } catch (sendError) {
            console.error('Failed to send error message:', sendError);
        }
    }
}

module.exports = router;
