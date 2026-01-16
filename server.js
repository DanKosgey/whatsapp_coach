const express = require('express');
const bodyParser = require('body-parser');
const webhookRouter = require('./webhook');
const scheduler = require('./scheduler');
const telegramBot = require('./telegram-bot');
const cors = require('cors');
const apiRouter = require('./routes/api');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // Allow all origins for dev
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health check endpoint (Used for Keep-Alive)
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'Discipline Coach AI (WhatsApp + Telegram)',
        platform: 'Render',
        timestamp: new Date().toISOString()
    });
});

// API Routes
app.use('/api', apiRouter);

// Webhook routes (WhatsApp)
app.use('/', webhookRouter);

// Start scheduler
scheduler.startScheduler();

// Start Telegram Bot
// Check if token exists to avoid crashing if not set up yet
if (process.env.TELEGRAM_BOT_TOKEN) {
    telegramBot.launch().then(() => {
        console.log(`🤖 Telegram bot launched: @${telegramBot.botInfo.username}`);
    }).catch((err) => {
        console.error('❌ Failed to launch Telegram bot:', err);
    });

    // Graceful stop for Telegram
    process.once('SIGINT', () => telegramBot.stop('SIGINT'));
    process.once('SIGTERM', () => telegramBot.stop('SIGTERM'));
} else {
    console.log('⚠️ TELEGRAM_BOT_TOKEN not found, skipping Telegram bot launch.');
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Webhook URL: ${process.env.BASE_URL}/webhook`);
    console.log(`✅ Ready to receive messages`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    process.exit(0);
});
