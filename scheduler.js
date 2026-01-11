const cron = require('node-cron');
const db = require('./db');
const whatsapp = require('./whatsapp-meta');
const aiAgent = require('./ai-agent');
require('dotenv').config();

// Schedule check-ins every 4 hours (example: 9 AM, 1 PM, 5 PM, 9 PM)
function startScheduler() {
    // Run every hour and check if any users need check-ins
    // Cron format: Minute Hour Day Month Weekday
    cron.schedule('0 * * * *', async () => {
        console.log('⏰ Running scheduled check-in task...');
        await sendScheduledCheckIns();
    });

    // Daily goal reminders at 8 AM
    cron.schedule('0 8 * * *', async () => {
        console.log('🎯 Running daily goal reminder task...');
        await sendGoalReminders();
    });

    // Daily energy credits at midnight
    cron.schedule('0 0 * * *', async () => {
        console.log('⚡ Running daily energy credit task...');
        await distributeDailyEnergy();
    });

    // Weekly summary every Sunday at 7 PM
    cron.schedule('0 19 * * 0', async () => {
        console.log('📊 Running weekly summary task...');
        await sendWeeklySummaries();
    });

    console.log('✅ Scheduler started successfully (Cron Mode)');
}

// Send check-ins based on user preferences
async function sendScheduledCheckIns() {
    try {
        const currentHour = new Date().getHours();
        const currentTime = `${currentHour.toString().padStart(2, '0')}:00`;

        // Get users who have this time in their check-in preferences
        const users = await db.query(
            `SELECT user_id, whatsapp_number, name, preferences, current_streak, current_energy
             FROM users 
             WHERE preferences->'check_in_times' ? $1
             AND (preferences->>'reminder_enabled')::boolean = true`,
            [currentTime]
        );

        for (const user of users) {
            // Check if user already checked in during this hour
            const existingLog = await db.query(
                `SELECT * FROM daily_logs 
                 WHERE user_id = $1 
                 AND log_date = CURRENT_DATE 
                 AND EXTRACT(HOUR FROM log_time) = $2`,
                [user.user_id, currentHour]
            );

            if (existingLog.length > 0) continue;

            // Generate personalized check-in message
            const checkInMessage = await aiAgent.generateAIResponse(
                user.user_id,
                'scheduled_check_in',
                'check_in'
            );

            // Send via WhatsApp
            await whatsapp.sendTextMessage(user.whatsapp_number, checkInMessage);
            console.log(`✅ Check-in sent to ${user.name}`);
        }
    } catch (error) {
        console.error('Error in scheduled check-ins:', error);
    }
}

async function sendGoalReminders() {
    try {
        const users = await db.query(
            `SELECT DISTINCT u.user_id, u.whatsapp_number, u.name 
             FROM users u
             INNER JOIN goals g ON u.user_id = g.user_id
             WHERE g.status = 'active'
             AND (g.last_reminded_at IS NULL OR g.last_reminded_at < NOW() - INTERVAL '1 day')`
        );

        for (const user of users) {
            const goals = await db.getGoalsDueForReminder(user.user_id);
            if (goals.length === 0) continue;

            const reminderMessage = await aiAgent.generateAIResponse(user.user_id, 'goal_reminder_request', 'goal_reminder');
            await whatsapp.sendTextMessage(user.whatsapp_number, reminderMessage);

            for (const goal of goals) {
                await db.query('UPDATE goals SET last_reminded_at = NOW() WHERE goal_id = $1', [goal.goal_id]);
            }
            console.log(`✅ Goal reminder sent to ${user.name}`);
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
        const users = await db.query('SELECT user_id, whatsapp_number, name FROM users');
        for (const user of users) {
            const summary = `📊 Weekly Summary for ${user.name}\nCheck app for details!`;
            // In real version, we re-calculate stats here, keeping it simple for brevity in revert
            await whatsapp.sendTextMessage(user.whatsapp_number, summary);
        }
    } catch (error) {
        console.error('Error sending weekly summaries:', error);
    }
}

module.exports = { startScheduler };
