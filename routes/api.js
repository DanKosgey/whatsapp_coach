const express = require('express');
const router = express.Router();
const db = require('../db');

// --- User Routes ---

// Get user stats (streak, energy, wins, etc.)
router.get('/user/:id', async (req, res) => {
    try {
        const userId = req.params.id;
        // Verify user exists first? For now assuming ID is valid UUID
        const stats = await db.getUserStats(userId);

        // Auto-create demo user if missing
        if (!stats && userId === '123e4567-e89b-12d3-a456-426614174000') {
            await db.query(`
                INSERT INTO users (user_id, whatsapp_number, name) 
                VALUES ($1, 'demo_user', 'Demo User') 
                ON CONFLICT (user_id) DO NOTHING
            `, [userId]);

            // Return empty stats
            return res.json({
                current_streak: 0,
                current_energy: 50
            });
        }

        if (!stats) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(stats);
    } catch (error) {
        console.error('Error fetching user stats:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.get('/user/:id/history', async (req, res) => {
    try {
        const history = await db.getUserEnergyHistory(req.params.id);
        res.json(history);
    } catch (error) {
        console.error('Error fetching/history:', error);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});



// Create or Get User (Simple Auth/Onboarding check)
router.post('/user/check-or-create', async (req, res) => {
    try {
        const { whatsappNumber, name } = req.body;
        // This is a simplified logic to sync with mobile if we use phone number
        // For mobile-first without phone, we might just create a generic user
        // This endpoint might need adjustment based on how the mobile app "identifies" itself
        // For now, let's assume the mobile app generates a UUID or sends a simplistic identifier if available

        // Placeholder implementation
        res.json({ message: 'User checked' });
    } catch (error) {
        res.status(500).json({ error: serverError(error) });
    }
});

// Update Energy manually (or sync)
router.post('/user/:id/energy', async (req, res) => {
    try {
        const userId = req.params.id;
        const { currentEnergy } = req.body;
        await db.updateUserEnergy(userId, currentEnergy);
        res.json({ success: true, currentEnergy });
    } catch (error) {
        console.error('Error updating energy:', error);
        res.status(500).json({ error: 'Failed to update energy' });
    }
});

// Update User Settings (Agent prefs)
router.put('/user/:id/settings', async (req, res) => {
    try {
        const userId = req.params.id;
        const { whatsappNumber, telegramUsername, preferredChannel } = req.body;
        await db.updateUserAgentSettings(userId, whatsappNumber, telegramUsername, preferredChannel);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// --- Event Routes ---

router.post('/events', async (req, res) => {
    try {
        const { userId, eventType, energyImpact, context, triggers } = req.body;
        const event = await db.logEvent(userId, eventType, energyImpact, context, triggers);

        // Also update energy transaction log
        await db.addEnergyTransaction(userId, energyImpact, 'event_log', `Logged ${eventType}`, event.event_id);

        res.json(event);
    } catch (error) {
        console.error('Error logging event:', error);
        res.status(500).json({ error: 'Failed to log event' });
    }
});

router.get('/events/:userId', async (req, res) => {
    try {
        const events = await db.query(
            `SELECT * FROM events WHERE user_id = $1 ORDER BY event_timestamp DESC LIMIT 50`,
            [req.params.userId]
        );
        res.json(events);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
});

// --- Goal Routes ---

router.get('/goals/:userId', async (req, res) => {
    try {
        const goals = await db.getUserGoals(req.params.userId);
        res.json(goals);
    } catch (error) {
        console.error('Error fetching goals:', error);
        res.status(500).json({ error: 'Failed to fetch goals' });
    }
});

router.post('/goals', async (req, res) => {
    try {
        const { userId, title, description, category, targetDate, energyAllocated } = req.body;
        const result = await db.query(
            `INSERT INTO goals (user_id, title, description, category, target_date, energy_allocated)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [userId, title, description || null, category || 'personal', targetDate, energyAllocated]
        );
        res.json(result[0]);
    } catch (error) {
        console.error('Error creating goal:', error);
        res.status(500).json({ error: 'Failed to create goal' });
    }
});

router.patch('/goals/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        await db.query(`UPDATE goals SET status = $1 WHERE goal_id = $2`, [status, req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating goal status:', error);
        res.status(500).json({ error: 'Failed to update goal status' });
    }
});

router.delete('/goals/:id', async (req, res) => {
    try {
        await db.query(`DELETE FROM goals WHERE goal_id = $1`, [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting goal:', error);
        res.status(500).json({ error: 'Failed to delete goal' });
    }
});

router.put('/goals/:id', async (req, res) => {
    try {
        const { title, description, category, targetDate, energyAllocated } = req.body;
        const result = await db.query(
            `UPDATE goals 
             SET title = COALESCE($1, title), 
                 description = COALESCE($2, description), 
                 category = COALESCE($3, category), 
                 target_date = COALESCE($4, target_date), 
                 energy_allocated = COALESCE($5, energy_allocated)
             WHERE goal_id = $6
             RETURNING *`,
            [title || null, description || null, category || null, targetDate || null, energyAllocated || null, req.params.id]
        );
        res.json(result[0]);
    } catch (error) {
        console.error('Error updating goal:', error);
        res.status(500).json({ error: 'Failed to update goal' });
    }
});





// --- Analytics Routes ---

// Get Energy Flow Data
router.get('/analytics/:userId/energy-flow', async (req, res) => {
    try {
        const data = await db.query(
            `SELECT * FROM mv_energy_flow_7d WHERE user_id = $1`,
            [req.params.userId]
        );
        res.json(data[0] || { base_daily: 10, streak_bonus: 0, activity_bonus: 0, losses: 0, current_energy: 50 });
    } catch (error) {
        console.error('Error fetching energy flow:', error);
        res.status(500).json({ error: 'Failed to fetch energy flow' });
    }
});

// Get Productivity Index
router.get('/analytics/:userId/productivity', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT calculate_productivity_index($1) as data`,
            [req.params.userId]
        );
        res.json(result[0]?.data || { productivity_index: 0, focus_hours: 0, output_multiplier: 1, zone: 'Recovery' });
    } catch (error) {
        console.error('Error calculating productivity:', error);
        res.status(500).json({ error: 'Failed to calculate productivity' });
    }
});

// Get Discipline Score
router.get('/analytics/:userId/discipline', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT calculate_discipline_score($1) as data`,
            [req.params.userId]
        );
        res.json(result[0]?.data || { overall_score: 0, grade: 'D', consistency: 0, streak_stability: 0, activity_adherence: 0, goal_progress: 0 });
    } catch (error) {
        console.error('Error calculating discipline:', error);
        res.status(500).json({ error: 'Failed to calculate discipline' });
    }
});

// Get Relapse Risk Analysis
router.get('/analytics/:userId/risk', async (req, res) => {
    try {
        // Use PostgreSQL logistic regression function
        const result = await db.query(
            `SELECT * FROM predict_relapse_risk($1)`,
            [req.params.userId]
        );

        if (result && result.length > 0) {
            const data = result[0];
            res.json({
                risk_probability: parseFloat(data.risk_probability),
                risk_level: data.risk_level,
                factors: data.factors // Already JSONB array from function
            });
        } else {
            // Fallback for users with no data
            res.json({
                risk_probability: 0.2,
                risk_level: 'LOW',
                factors: [{
                    name: 'No Data',
                    impact: 'low_risk',
                    description: 'Insufficient data for risk prediction'
                }]
            });
        }
    } catch (error) {
        console.error('Error calculating risk:', error);
        res.status(500).json({ error: 'Failed to calculate risk' });
    }
});

// Get Survival Analysis
router.get('/analytics/:userId/survival', async (req, res) => {
    try {
        // Use get_survival_curve function for comprehensive data
        const curveData = await db.query(
            `SELECT * FROM get_survival_curve($1)`,
            [req.params.userId]
        );

        // Get relapse history from streak_history table
        const relapseHistory = await db.query(
            `SELECT length_days FROM streak_history 
             WHERE user_id = $1 AND end_reason IS NOT NULL 
             ORDER BY end_date DESC LIMIT 10`,
            [req.params.userId]
        );

        const data = curveData[0] || {};
        res.json({
            current_streak: data.current_streak || 0,
            max_streak: data.max_streak || 0,
            median_survival: parseFloat(data.median_survival) || 0,
            survival_day_7: parseFloat(data.survival_day_7) || 1.0,
            survival_day_30: parseFloat(data.survival_day_30) || 1.0,
            survival_day_90: parseFloat(data.survival_day_90) || 1.0,
            total_attempts: parseInt(data.total_attempts) || 0,
            danger_zones: data.danger_zones || [],
            relapse_history: relapseHistory.map(r => r.length_days)
        });
    } catch (error) {
        console.error('Error fetching survival data:', error);
        res.status(500).json({ error: 'Failed to fetch survival data' });
    }
});

// Get Recovery Progress
router.get('/analytics/:userId/recovery', async (req, res) => {
    try {
        const user = await db.query(`SELECT current_streak FROM users WHERE user_id = $1`, [req.params.userId]);
        const streak = user[0]?.current_streak || 0;

        // Use get_recovery_phase function
        const result = await db.query(
            `SELECT * FROM get_recovery_phase($1)`,
            [streak]
        );

        const data = result[0] || {};
        res.json({
            streak_days: streak,
            phase: data.phase || 'Withdrawal',
            phase_number: parseInt(data.phase_number) || 1,
            progress_percent: parseFloat(data.progress_percent) || 0,
            dopamine_recovery: parseFloat(data.dopamine_recovery) || 0,
            androgen_sensitivity: parseFloat(data.androgen_sensitivity) || 0,
            prefrontal_changes: parseFloat(data.prefrontal_changes) || 0,
            description: data.description || 'Starting recovery journey'
        });
    } catch (error) {
        console.error('Error fetching recovery data:', error);
        res.status(500).json({ error: 'Failed to fetch recovery data' });
    }
});

// Get Detailed Energy History (30 days)
router.get('/analytics/:userId/energy-history', async (req, res) => {
    try {
        const history = await db.query(
            `SELECT 
                DATE(transaction_date) as day,
                MAX(running_balance) as energy,
                SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as gains,
                ABS(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)) as losses
             FROM energy_transactions
             WHERE user_id = $1
             AND transaction_date >= CURRENT_DATE - INTERVAL '30 days'
             GROUP BY DATE(transaction_date)
             ORDER BY day DESC`,
            [req.params.userId]
        );

        // Calculate 7-day moving average
        const withTrends = history.map((item, index) => {
            const window = history.slice(Math.max(0, index - 6), index + 1);
            const avg = window.reduce((sum, d) => sum + d.energy, 0) / window.length;
            return {
                ...item,
                moving_avg: Math.round(avg),
                trend: index > 0 ? item.energy - history[index - 1].energy : 0
            };
        });

        res.json(withTrends);
    } catch (error) {
        console.error('Error fetching energy history:', error);
        res.status(500).json({ error: 'Failed to fetch energy history' });
    }
});

// Get Trigger Analysis (Heatmap data)
router.get('/analytics/:userId/trigger-analysis', async (req, res) => {
    try {
        // Aggregate triggers by hour and day of week
        const triggerData = await db.query(
            `SELECT 
                EXTRACT(HOUR FROM event_timestamp) as hour,
                EXTRACT(DOW FROM event_timestamp) as day_of_week,
                COUNT(*) as trigger_count,
                ARRAY_AGG(DISTINCT t) FILTER (WHERE t IS NOT NULL) as common_triggers
             FROM events
             LEFT JOIN LATERAL unnest(triggers) as t ON true
             WHERE user_id = $1
             AND event_type IN ('relapse', 'sexual_activity')
             AND event_timestamp >= CURRENT_DATE - INTERVAL '90 days'
             GROUP BY hour, day_of_week
             ORDER BY day_of_week, hour`,
            [req.params.userId]
        );

        // Also get urge intensity patterns from daily_logs
        const urgePatterns = await db.query(
            `SELECT 
                EXTRACT(HOUR FROM log_time) as hour,
                EXTRACT(DOW FROM log_date) as day_of_week,
                AVG(urges_intensity) as avg_urges,
                AVG(stress_level) as avg_stress
             FROM daily_logs
             WHERE user_id = $1
             AND log_date >= CURRENT_DATE - INTERVAL '90 days'
             AND urges_intensity IS NOT NULL
             GROUP BY hour, day_of_week
             ORDER BY day_of_week, hour`,
            [req.params.userId]
        );

        res.json({
            trigger_events: triggerData,
            urge_patterns: urgePatterns,
            summary: {
                total_triggers: triggerData.reduce((sum, t) => sum + parseInt(t.trigger_count), 0),
                highest_risk_hour: triggerData.length > 0
                    ? triggerData.reduce((max, t) => parseInt(t.trigger_count) > parseInt(max.trigger_count) ? t : max).hour
                    : null,
                highest_risk_day: triggerData.length > 0
                    ? triggerData.reduce((max, t) => parseInt(t.trigger_count) > parseInt(max.trigger_count) ? t : max).day_of_week
                    : null
            }
        });
    } catch (error) {
        console.error('Error fetching trigger analysis:', error);
        res.status(500).json({ error: 'Failed to fetch trigger analysis' });
    }
});

// Get Energy Forecast (Predictive Model)
router.get('/analytics/:userId/forecast', async (req, res) => {
    try {
        const history = await db.query(
            `SELECT DATE(transaction_date) as day, MAX(running_balance) as energy
             FROM energy_transactions WHERE user_id = $1
             AND transaction_date >= CURRENT_DATE - INTERVAL '30 days'
             GROUP BY DATE(transaction_date) ORDER BY day ASC`,
            [req.params.userId]
        );

        if (history.length < 7) {
            return res.json({
                current: 0, forecast_30d_optimistic: 0, forecast_30d_conservative: 0,
                forecast_60d_optimistic: 0, forecast_60d_conservative: 0, forecast_90d_optimistic: 0,
                forecast_90d_conservative: 0, confidence: 'low', trend: 'insufficient_data'
            });
        }

        const energyValues = history.map(h => h.energy);
        const current = energyValues[energyValues.length - 1];
        const recentAvg = energyValues.slice(-7).reduce((a, b) => a + b, 0) / 7;
        const olderAvg = energyValues.slice(0, Math.min(7, energyValues.length - 7)).reduce((a, b) => a + b, 0) / Math.min(7, energyValues.length - 7);
        const dailyGrowth = (recentAvg - olderAvg) / 7;

        const user = await db.query(`SELECT current_streak FROM users WHERE user_id = $1`, [req.params.userId]);
        const streak = user[0]?.current_streak || 0;
        const expectedDailyGain = 10 + (streak <= 7 ? 2 * streak : 5 * (streak - 7) + 14);

        const optimisticGrowth = Math.max(dailyGrowth, expectedDailyGain * 0.8);
        const conservativeGrowth = Math.max(dailyGrowth * 0.5, expectedDailyGain * 0.3);

        const variance = energyValues.reduce((sum, val) => sum + Math.pow(val - recentAvg, 2), 0) / energyValues.length;
        const confidence = Math.sqrt(variance) < 50 ? 'high' : Math.sqrt(variance) < 100 ? 'medium' : 'low';

        res.json({
            current, forecast_30d_optimistic: Math.round(current + optimisticGrowth * 30),
            forecast_30d_conservative: Math.round(current + conservativeGrowth * 30),
            forecast_60d_optimistic: Math.round(current + optimisticGrowth * 60),
            forecast_60d_conservative: Math.round(current + conservativeGrowth * 60),
            forecast_90d_optimistic: Math.round(current + optimisticGrowth * 90),
            forecast_90d_conservative: Math.round(current + conservativeGrowth * 90),
            daily_growth: Math.round(dailyGrowth * 10) / 10, confidence,
            trend: dailyGrowth > 5 ? 'strong_growth' : dailyGrowth > 0 ? 'growth' : dailyGrowth > -5 ? 'stable' : 'declining'
        });
    } catch (error) {
        console.error('Error calculating forecast:', error);
        res.status(500).json({ error: 'Failed to calculate forecast' });
    }
});

// Refresh materialized views
router.post('/analytics/refresh', async (req, res) => {
    try {
        await db.query(`SELECT refresh_analytics_views()`);
        res.json({ success: true, message: 'Analytics views refreshed' });
    } catch (error) {
        console.error('Error refreshing views:', error);
        res.status(500).json({ error: 'Failed to refresh views' });
    }
});

module.exports = router;
