const db = require('./db');

async function applyDisciplineSchema() {
    console.log('Applying discipline and metrics schema...');

    try {
        // 1. Create Streak History Table
        console.log('Creating streak_history table...');
        await db.query(`
            CREATE TABLE IF NOT EXISTS streak_history (
                streak_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                start_date DATE NOT NULL,
                end_date DATE,
                length_days INTEGER,
                end_reason VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 2. Create Daily Aggregates Table
        console.log('Creating daily_aggregates table...');
        await db.query(`
            CREATE TABLE IF NOT EXISTS daily_aggregates (
                aggregate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
                date DATE NOT NULL,
                total_energy_gained INTEGER DEFAULT 0,
                total_energy_lost INTEGER DEFAULT 0,
                check_ins_count INTEGER DEFAULT 0,
                activities_completed INTEGER DEFAULT 0,
                avg_mood DECIMAL(3,1),
                avg_urges DECIMAL(3,1),
                avg_stress DECIMAL(3,1),
                avg_focus DECIMAL(3,1),
                exercised BOOLEAN DEFAULT FALSE,
                meditated BOOLEAN DEFAULT FALSE,
                cold_shower BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, date)
            )
        `);

        // 3. Create Materialized View for Discipline
        console.log('Creating mv_user_discipline_metrics view...');
        // Note: We use simple aggregation here. If events table is missing, this might fail, 
        // but we assume events exists from previous context.
        await db.query(`
            CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_discipline_metrics AS
            SELECT 
                u.user_id,
                -- Consistency: check-ins in last 30 days / 30
                COALESCE(
                    (SELECT COUNT(DISTINCT log_date) 
                     FROM daily_logs 
                     WHERE user_id = u.user_id 
                     AND log_date >= CURRENT_DATE - INTERVAL '30 days')::DECIMAL / 30,
                    0
                ) AS consistency,
                
                -- Streak Stability
                CASE 
                    WHEN u.current_streak = 0 THEN 0
                    ELSE u.current_streak::DECIMAL / 
                         (u.current_streak + 7) -- Simplified fallback stability calculation
                END AS streak_stability,
                
                -- Activity Adherence
                COALESCE(
                    (SELECT COUNT(*) 
                     FROM daily_logs 
                     WHERE user_id = u.user_id 
                     AND (exercised = TRUE OR meditated = TRUE)
                     AND log_date >= CURRENT_DATE - INTERVAL '30 days')::DECIMAL / 30,
                    0
                ) AS activity_adherence,
                
                -- Goal Progress
                COALESCE(
                    (SELECT COUNT(*) FROM goals WHERE user_id = u.user_id AND status = 'completed')::DECIMAL /
                    NULLIF((SELECT COUNT(*) FROM goals WHERE user_id = u.user_id), 0),
                    0
                ) AS goal_progress
                
            FROM users u
        `);

        // 4. Create Unique Index for Refresh
        console.log('Creating index on materialized view...');
        await db.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_discipline_user ON mv_user_discipline_metrics(user_id)
        `);

        // 5. Create Calculate Discipline Score Function
        console.log('Creating calculate_discipline_score()...');
        await db.query(`
            CREATE OR REPLACE FUNCTION calculate_discipline_score(p_user_id UUID)
            RETURNS TABLE(
                overall_score DECIMAL,
                grade CHAR(1),
                consistency DECIMAL,
                streak_stability DECIMAL,
                activity_adherence DECIMAL,
                goal_progress DECIMAL
            ) AS $$
            DECLARE
                v_score DECIMAL;
            BEGIN
                -- Ensure view is populated for this user (refreshing whole view is expensive, but for now ok)
                -- Ideally we use a trigger or scheduled job.
                
                SELECT 
                    (m.consistency * 0.25 + 
                     m.streak_stability * 0.40 + 
                     m.activity_adherence * 0.20 + 
                     m.goal_progress * 0.15) * 100,
                    m.consistency,
                    m.streak_stability,
                    m.activity_adherence,
                    m.goal_progress
                INTO v_score, consistency, streak_stability, activity_adherence, goal_progress
                FROM mv_user_discipline_metrics m
                WHERE m.user_id = p_user_id;
                
                -- If no data found (e.g. view not refreshed or user new), return defaults
                IF v_score IS NULL THEN
                   v_score := 0;
                   consistency := 0;
                   streak_stability := 0;
                   activity_adherence := 0;
                   goal_progress := 0;
                END IF;
                
                RETURN QUERY SELECT 
                    v_score,
                    CASE 
                        WHEN v_score >= 90 THEN 'S'
                        WHEN v_score >= 80 THEN 'A'
                        WHEN v_score >= 70 THEN 'B'
                        WHEN v_score >= 60 THEN 'C'
                        ELSE 'D'
                    END::CHAR(1),
                    consistency,
                    streak_stability,
                    activity_adherence,
                    goal_progress;
            END;
            $$ LANGUAGE plpgsql;
        `);

        // 6. Refresh Analytics Views Function
        console.log('Creating refresh_analytics_views()...');
        await db.query(`
            CREATE OR REPLACE FUNCTION refresh_analytics_views()
            RETURNS VOID AS $$
            BEGIN
                REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_discipline_metrics;
            END;
            $$ LANGUAGE plpgsql;
        `);

        console.log('✅ Successfully applied discipline schema and functions!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Failed to apply discipline schema:', error);
        process.exit(1);
    }
}

applyDisciplineSchema();
