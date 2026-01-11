const express = require('express');
const scheduler = require('./scheduler');
const router = express.Router();

// Middleware to secure cron endpoints (Optional but recommended)
// In Vercel, you can set CRON_SECRET env var and check it here
const verifyCron = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        // Allow if running in development or if strictly testing
        if (process.env.NODE_ENV === 'production') {
            return res.status(401).json({ error: 'Unauthorized' });
        }
    }
    next();
};

router.get('/check-ins', verifyCron, async (req, res) => {
    try {
        const result = await scheduler.sendScheduledCheckIns();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/goals', verifyCron, async (req, res) => {
    try {
        const result = await scheduler.sendGoalReminders();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/daily-energy', verifyCron, async (req, res) => {
    try {
        const result = await scheduler.distributeDailyEnergy();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.get('/weekly-summary', verifyCron, async (req, res) => {
    try {
        const result = await scheduler.sendWeeklySummaries();
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
