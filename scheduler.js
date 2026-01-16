const cron = require('node-cron');
const db = require('./db');
const whatsapp = require('./whatsapp-meta');
const telegramBot = require('./telegram-bot');
const aiAgent = require('./ai-agent');
require('dotenv').config();

async function sendMessage(user, text) {
    // Default to 'whatsapp' if not set, or if set to 'whatsapp'
    // If set to 'telegram', try telegram.
    const channel = user.preferred_channel || 'whatsapp';

    if (channel === 'telegram' && user.telegram_id) {
        try {
            await telegramBot.telegram.sendMessage(user.telegram_id, text);
            console.log(`✅ Sent Telegram msg to ${user.name}`);
        } catch (e) {
            console.error(`❌ Failed Telegram msg to ${user.name}`, e);
        }
    } else if (user.whatsapp_number) {
        // Fallback or explicit whatsapp
        try {
            await whatsapp.sendTextMessage(user.whatsapp_number, text);
            console.log(`✅ Sent WhatsApp msg to ${user.name}`);
        } catch (e) {
            console.error(`❌ Failed WhatsApp msg to ${user.name}`, e);
        }
    } else {
        console.log(`⚠️ User ${user.name} has no contact info for ${channel}`);
    }
}

function startScheduler() {
    // Check-ins
    cron.schedule('0 * * * *', async () => {
        console.log('⏰ Running scheduled check-in task...');
        await sendScheduledCheckIns();
    });

    // Goals
    cron.schedule('0 8 * * *', async () => {
        console.log('🎯 Running daily goal reminder task...');
        await sendGoalReminders();
    });

    // Daily energy
    cron.schedule('0 0 * * *', async () => {
        console.log('⚡ Running daily energy credit task...');
        await distributeDailyEnergy();
    });

    // Weekly summary
    cron.schedule('0 19 * * 0', async () => {
        console.log('📊 Running weekly summary task...');
        await sendWeeklySummaries();
    });

    console.log('✅ Scheduler started (Cron Mode)');
}

async function sendScheduledCheckIns() {
    try {
        const currentHour = new Date().getHours();
        const currentTime = `${currentHour.toString().padStart(2, '0')}:00`;

        const users = await db.query(
            `SELECT user_id, whatsapp_number, telegram_id, name, preferences, current_streak, current_energy, preferred_channel
             FROM users 
             WHERE preferences->'check_in_times' ? $1
             AND (preferences->>'reminder_enabled')::boolean = true`,
            [currentTime]
        );

        for (const user of users) {
            const existingLog = await db.query(
                `SELECT * FROM daily_logs 
                 WHERE user_id = $1 
                 AND log_date = CURRENT_DATE 
                 AND EXTRACT(HOUR FROM log_time) = $2`,
                [user.user_id, currentHour]
            );

            if (existingLog.length > 0) continue;

            const checkInMessage = await aiAgent.generateAIResponse(
                user.user_id,
                'scheduled_check_in',
                'check_in'
            );

            await sendMessage(user, checkInMessage);
        }
    } catch (error) {
        console.error('Error in scheduled check-ins:', error);
    }
}

async function sendGoalReminders() {
    try {
        const users = await db.query(
            `SELECT DISTINCT u.user_id, u.whatsapp_number, u.telegram_id, u.name, u.preferred_channel
             FROM users u
             INNER JOIN goals g ON u.user_id = g.user_id
             WHERE g.status = 'active'
             AND (g.last_reminded_at IS NULL OR g.last_reminded_at < NOW() - INTERVAL '1 day')`
        );

        for (const user of users) {
            const goals = await db.getGoalsDueForReminder(user.user_id);
            if (goals.length === 0) continue;

            const reminderMessage = await aiAgent.generateAIResponse(user.user_id, 'goal_reminder_request', 'goal_reminder');
            await sendMessage(user, reminderMessage);

            for (const goal of goals) {
                await db.query('UPDATE goals SET last_reminded_at = NOW() WHERE goal_id = $1', [goal.goal_id]);
            }
        }
    } catch (error) {
        console.error('Error sending goal reminders:', error);
    }
}

async function distributeDailyEnergy() {
    try {
        const users = await db.query('SELECT user_id, current_streak FROM users');
        for (const user of users) {
            let energyAmount = 10 + Math.min(user.current_streak, 30);
            await db.addEnergyTransaction(user.user_id, energyAmount, 'daily_baseline', 'Daily energy');
            await db.updateUserStreak(user.user_id, user.current_streak + 1);
        }
        console.log(`✅ Daily energy distributed`);
    } catch (error) {
        console.error('Error distributing daily energy:', error);
    }
}

async function sendWeeklySummaries() {
    try {
        const users = await db.query('SELECT user_id, whatsapp_number, telegram_id, name, preferred_channel FROM users');
        for (const user of users) {
            const summary = `📊 Weekly Summary for ${user.name}\nCheck app for details!`;
            await sendMessage(user, summary);
        }
    } catch (error) {
        console.error('Error sending weekly summaries:', error);
    }
}

module.exports = { startScheduler };
