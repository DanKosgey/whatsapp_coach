const express = require('express');
const bodyParser = require('body-parser');
const webhookRouter = require('./webhook');
const scheduler = require('./scheduler');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health check endpoint (Used for Keep-Alive)
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'WhatsApp Celibacy Tracker',
        platform: 'Render',
        timestamp: new Date().toISOString()
    });
});

// Webhook routes
app.use('/', webhookRouter);

// Start scheduler
scheduler.startScheduler();

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📍 Webhook URL: ${process.env.BASE_URL}/webhook`);
    console.log(`✅ Ready to receive WhatsApp messages`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    process.exit(0);
});
