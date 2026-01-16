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

async function getUserByTelegramId(telegramId) {
    const result = await query(
        'SELECT * FROM users WHERE telegram_id = $1',
        [telegramId]
    );
    return result[0];
}

async function createUser(whatsappNumber, name) {
    const result = await query(
        `INSERT INTO users (whatsapp_number, name, preferred_channel) 
         VALUES ($1, $2, 'whatsapp') 
         RETURNING *`,
        [whatsappNumber, name]
    );
    return result[0];
}

async function createTelegramUser(telegramId, username, firstName, lastName) {
    const name = `${firstName || ''} ${lastName || ''}`.trim() || username || 'User';
    const result = await query(
        `INSERT INTO users (telegram_id, telegram_username, name, preferred_channel) 
         VALUES ($1, $2, $3, 'telegram') 
         RETURNING *`,
        [telegramId, username, name]
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

async function updateUserPreference(userId, platform) {
    await query(
        'UPDATE users SET preferred_channel = $1 WHERE user_id = $2',
        [platform, userId]
    );
}

async function updateUserAgentSettings(userId, whatsappNumber, telegramUsername, preferredChannel) {
    await query(
        `UPDATE users 
         SET whatsapp_number = COALESCE($1, whatsapp_number),
             telegram_username = COALESCE($2, telegram_username),
             preferred_channel = COALESCE($3, preferred_channel)
         WHERE user_id = $4`,
        [whatsappNumber, telegramUsername, preferredChannel, userId]
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
async function saveConversation(userId, sender, messageText, messageType, aiContext = null, platformId = null, platform = 'whatsapp') {
    let telegramId = null;
    let whatsappId = null;

    if (platform === 'telegram') {
        telegramId = platformId;
    } else {
        whatsappId = platformId;
    }

    await query(
        `INSERT INTO conversations (user_id, sender, message_text, message_type, ai_context, whatsapp_message_id, telegram_message_id, platform)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, sender, messageText, messageType, JSON.stringify(aiContext), whatsappId, telegramId, platform]
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

async function getRecentEvents(userId, limit = 50) {
    const result = await query(
        `SELECT * FROM events 
         WHERE user_id = $1 
         ORDER BY event_timestamp DESC 
         LIMIT $2`,
        [userId, limit]
    );
    return result;
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
         WHERE user_id = $1
         ORDER BY 
            CASE WHEN status = 'active' THEN 0 ELSE 1 END,
            target_date ASC`,
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

// Stats (New)
async function getUserStats(userId) {
    const stats = await query(
        `WITH TodayGain AS (
            SELECT COALESCE(SUM(amount), 0) as gain 
            FROM energy_transactions 
            WHERE user_id = $1 
            AND transaction_date >= CURRENT_DATE
            AND amount > 0
        ),
        ActiveGoals AS (
            SELECT COUNT(*) as count 
            FROM goals 
            WHERE user_id = $1 
            AND status = 'active'
        )
        SELECT 
            u.current_streak,
            u.current_energy,
            u.preferences,
            (SELECT gain FROM TodayGain) as todays_gain,
            (SELECT count FROM ActiveGoals) as active_goals_count,
            COUNT(DISTINCT dl.log_date) as total_check_ins,
            AVG(dl.energy_level) as avg_energy,
            AVG(dl.mood_score) as avg_mood,
            COUNT(CASE WHEN e.event_type = 'major_win' THEN 1 END) as total_wins,
            COUNT(CASE WHEN e.event_type = 'relapse' THEN 1 END) as total_relapses
         FROM users u
         LEFT JOIN daily_logs dl ON u.user_id = dl.user_id
         LEFT JOIN events e ON u.user_id = e.user_id
         WHERE u.user_id = $1
         GROUP BY u.user_id, u.current_streak, u.current_energy, u.preferences`,
        [userId]
    );
    return stats[0];
}

async function getUserEnergyHistory(userId, days = 7) {
    // This query constructs a daily history by summing transactions per day
    // It's a bit complex because we need to reconstruct running balances or just aggregation
    // For simplicity in MVP: We will return the 'running_balance' of the LAST transaction of each day
    // If no transaction on a day, we take the previous day's value (gaps).

    // Actually, a simpler approach for MVP:
    // Just get energy transactions in the last N days and we can process on frontend or here.
    // Let's return the simplified view: daily active energy gain? 
    // The simplified view: Total energy at end of each day.

    const result = await query(
        `WITH DateSeries AS (
            SELECT generate_series(CURRENT_DATE - ($2 || ' days')::INTERVAL, CURRENT_DATE, '1 day')::DATE AS day
         ),
         DailyBalance AS (
            SELECT 
                DATE(transaction_date) as t_date, 
                running_balance,
                ROW_NUMBER() OVER (PARTITION BY DATE(transaction_date) ORDER BY transaction_date DESC) as rn
            FROM energy_transactions
            WHERE user_id = $1
            AND transaction_date >= CURRENT_DATE - ($2 || ' days')::INTERVAL
         )
         SELECT 
             ds.day, 
             COALESCE(db.running_balance, (
                 SELECT running_balance FROM energy_transactions 
                 WHERE user_id = $1 AND transaction_date < ds.day 
                 ORDER BY transaction_date DESC LIMIT 1
             ), 0) as energy
         FROM DateSeries ds
         LEFT JOIN DailyBalance db ON ds.day = db.t_date AND db.rn = 1
         ORDER BY ds.day ASC`,
        [userId, days]
    );
    return result;
}

module.exports = {
    query,
    getUserByWhatsApp,
    getUserByTelegramId,
    createUser,
    createTelegramUser,
    updateUserStreak,
    updateUserEnergy,
    updateUserPreference,
    updateUserAgentSettings,
    saveDailyLog,
    saveConversation,
    getRecentConversations,
    logEvent,
    getRecentEvents,
    addEnergyTransaction,
    getUserGoals,
    getGoalsDueForReminder,
    getUserStats,
    getUserEnergyHistory,
};
