const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql = neon(process.env.DATABASE_URL);

// Helper functions
async function query(text, params) {
    try {
        const result = await sql(text, params);
        return result;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

// User operations
async function getUserByWhatsApp(whatsappNumber) {
    const result = await query(
        'SELECT * FROM users WHERE whatsapp_number = $1',
        [whatsappNumber]
    );
    return result[0];
}

async function createUser(whatsappNumber, name) {
    const result = await query(
        `INSERT INTO users (whatsapp_number, name) 
         VALUES ($1, $2) 
         RETURNING *`,
        [whatsappNumber, name]
    );
    return result[0];
}

async function updateUserStreak(userId, newStreak) {
    await query(
        'UPDATE users SET current_streak = $1 WHERE user_id = $2',
        [newStreak, userId]
    );
}

async function updateUserEnergy(userId, newEnergy) {
    await query(
        'UPDATE users SET current_energy = $1 WHERE user_id = $2',
        [newEnergy, userId]
    );
}

// Daily log operations
async function saveDailyLog(userId, logData) {
    const result = await query(
        `INSERT INTO daily_logs 
         (user_id, log_date, log_time, energy_level, mood_score, urges_intensity, 
          stress_level, focus_quality, raw_message, sentiment_positive, 
          sentiment_negative, sentiment_compound, exercised, meditated, 
          cold_shower, triggers_mentioned, accomplishments)
         VALUES ($1, CURRENT_DATE, CURRENT_TIME, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
            userId, logData.energy_level, logData.mood_score, logData.urges_intensity,
            logData.stress_level, logData.focus_quality, logData.raw_message,
            logData.sentiment_positive, logData.sentiment_negative, logData.sentiment_compound,
            logData.exercised, logData.meditated, logData.cold_shower,
            logData.triggers_mentioned, logData.accomplishments
        ]
    );
    return result[0];
}

// Conversation history
async function saveConversation(userId, sender, messageText, messageType, aiContext = null, whatsappMessageId = null) {
    await query(
        `INSERT INTO conversations (user_id, sender, message_text, message_type, ai_context, whatsapp_message_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, sender, messageText, messageType, JSON.stringify(aiContext), whatsappMessageId]
    );
}

async function getRecentConversations(userId, limit = 10) {
    const result = await query(
        `SELECT * FROM conversations 
         WHERE user_id = $1 
         ORDER BY message_timestamp DESC 
         LIMIT $2`,
        [userId, limit]
    );
    return result.reverse(); // Return in chronological order
}

// Event logging
async function logEvent(userId, eventType, energyImpact, context, triggers) {
    const result = await query(
        `INSERT INTO events (user_id, event_type, energy_impact, context_before, triggers)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, eventType, energyImpact, context, triggers]
    );
    return result[0];
}

// Energy transactions
async function addEnergyTransaction(userId, amount, source, description, relatedEventId = null) {
    const user = await query('SELECT current_energy FROM users WHERE user_id = $1', [userId]);
    const newBalance = (user[0]?.current_energy || 0) + amount;

    await query(
        `INSERT INTO energy_transactions 
         (user_id, amount, source, description, running_balance, related_event_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, amount, source, description, newBalance, relatedEventId]
    );

    await updateUserEnergy(userId, newBalance);
    return newBalance;
}

// Goals
async function getUserGoals(userId) {
    const result = await query(
        `SELECT * FROM goals 
         WHERE user_id = $1 AND status = 'active'
         ORDER BY target_date ASC`,
        [userId]
    );
    return result;
}

async function getGoalsDueForReminder(userId) {
    const result = await query(
        `SELECT * FROM goals 
         WHERE user_id = $1 
         AND status = 'active'
         AND (last_reminded_at IS NULL OR last_reminded_at < NOW() - INTERVAL '1 day')`,
        [userId]
    );
    return result;
}

module.exports = {
    query,
    getUserByWhatsApp,
    createUser,
    updateUserStreak,
    updateUserEnergy,
    saveDailyLog,
    saveConversation,
    getRecentConversations,
    logEvent,
    addEnergyTransaction,
    getUserGoals,
    getGoalsDueForReminder
};
