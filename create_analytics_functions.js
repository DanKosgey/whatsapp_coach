const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

const sql = neon(process.env.DATABASE_URL);

// Simplified functions that work with Neon's limitations
const functions = [
    // 1. Productivity Index - simplified version
    `CREATE OR REPLACE FUNCTION calculate_productivity_index(p_user_id UUID)
    RETURNS JSON AS $$
    DECLARE
        result JSON;
    BEGIN
        SELECT json_build_object(
            'productivity_index', 15 * LN(1 + COALESCE(u.current_energy, 50)::DECIMAL / 100) + 
                                 10 * COALESCE((m.consistency * 0.25 + m.streak_stability * 0.40 + 
                                               m.activity_adherence * 0.20 + m.goal_progress * 0.15), 0),
            'focus_hours', (15 * LN(1 + COALESCE(u.current_energy, 50)::DECIMAL / 100) + 
                           10 * COALESCE((m.consistency * 0.25 + m.streak_stability * 0.40 + 
                                         m.activity_adherence * 0.20 + m.goal_progress * 0.15), 0)) * 0.5,
            'output_multiplier', 1 + (COALESCE(u.current_energy, 50) - 50)::DECIMAL / 500,
            'zone', CASE 
                WHEN (15 * LN(1 + COALESCE(u.current_energy, 50)::DECIMAL / 100)) < 10 THEN 'Recovery'
                WHEN (15 * LN(1 + COALESCE(u.current_energy, 50)::DECIMAL / 100)) < 20 THEN 'Normal'
                WHEN (15 * LN(1 + COALESCE(u.current_energy, 50)::DECIMAL / 100)) < 30 THEN 'Enhanced'
                WHEN (15 * LN(1 + COALESCE(u.current_energy, 50)::DECIMAL / 100)) < 40 THEN 'Peak'
                ELSE 'Superhuman'
            END
        ) INTO result
        FROM users u
        LEFT JOIN mv_user_discipline_metrics m ON m.user_id = u.user_id
        WHERE u.user_id = p_user_id;
        
        RETURN result;
    END;
    $$ LANGUAGE plpgsql`,

    // 2. Discipline Score
    `CREATE OR REPLACE FUNCTION calculate_discipline_score(p_user_id UUID)
    RETURNS JSON AS $$
    DECLARE
        result JSON;
    BEGIN
        SELECT json_build_object(
            'overall_score', (m.consistency * 0.25 + m.streak_stability * 0.40 + 
                             m.activity_adherence * 0.20 + m.goal_progress * 0.15) * 100,
            'grade', CASE 
                WHEN (m.consistency * 0.25 + m.streak_stability * 0.40 + 
                      m.activity_adherence * 0.20 + m.goal_progress * 0.15) * 100 >= 90 THEN 'S'
                WHEN (m.consistency * 0.25 + m.streak_stability * 0.40 + 
                      m.activity_adherence * 0.20 + m.goal_progress * 0.15) * 100 >= 80 THEN 'A'
                WHEN (m.consistency * 0.25 + m.streak_stability * 0.40 + 
                      m.activity_adherence * 0.20 + m.goal_progress * 0.15) * 100 >= 70 THEN 'B'
                WHEN (m.consistency * 0.25 + m.streak_stability * 0.40 + 
                      m.activity_adherence * 0.20 + m.goal_progress * 0.15) * 100 >= 60 THEN 'C'
                ELSE 'D'
            END,
            'consistency', m.consistency,
            'streak_stability', m.streak_stability,
            'activity_adherence', m.activity_adherence,
            'goal_progress', m.goal_progress
        ) INTO result
        FROM mv_user_discipline_metrics m
        WHERE m.user_id = p_user_id;
        
        RETURN COALESCE(result, '{"overall_score": 0, "grade": "D", "consistency": 0, "streak_stability": 0, "activity_adherence": 0, "goal_progress": 0}'::JSON);
    END;
    $$ LANGUAGE plpgsql`,

    // 3. Refresh views function
    `CREATE OR REPLACE FUNCTION refresh_analytics_views()
    RETURNS VOID AS $$
    BEGIN
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_discipline_metrics;
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_energy_flow_7d;
        REFRESH MATERIALIZED VIEW CONCURRENTLY mv_survival_probabilities;
    END;
    $$ LANGUAGE plpgsql`,

    // 4. Trigger functions
    `CREATE OR REPLACE FUNCTION update_daily_aggregates()
    RETURNS TRIGGER AS $$
    BEGIN
        INSERT INTO daily_aggregates (
            user_id, date, check_ins_count, avg_mood, avg_urges, avg_stress, avg_focus,
            exercised, meditated, cold_shower
        )
        VALUES (
            NEW.user_id, NEW.log_date, 1, NEW.mood_score, NEW.urges_intensity, 
            NEW.stress_level, NEW.focus_quality, NEW.exercised, NEW.meditated, NEW.cold_shower
        )
        ON CONFLICT (user_id, date) DO UPDATE SET
            check_ins_count = daily_aggregates.check_ins_count + 1,
            avg_mood = (daily_aggregates.avg_mood * daily_aggregates.check_ins_count + NEW.mood_score) / (daily_aggregates.check_ins_count + 1),
            avg_urges = (daily_aggregates.avg_urges * daily_aggregates.check_ins_count + NEW.urges_intensity) / (daily_aggregates.check_ins_count + 1),
            avg_stress = (daily_aggregates.avg_stress * daily_aggregates.check_ins_count + NEW.stress_level) / (daily_aggregates.check_ins_count + 1),
            avg_focus = (daily_aggregates.avg_focus * daily_aggregates.check_ins_count + NEW.focus_quality) / (daily_aggregates.check_ins_count + 1),
            exercised = daily_aggregates.exercised OR NEW.exercised,
            meditated = daily_aggregates.meditated OR NEW.meditated,
            cold_shower = daily_aggregates.cold_shower OR NEW.cold_shower;
        
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`,

    `CREATE TRIGGER trigger_update_daily_aggregates
    AFTER INSERT ON daily_logs
    FOR EACH ROW
    EXECUTE FUNCTION update_daily_aggregates()`,

    `CREATE OR REPLACE FUNCTION track_streak_on_relapse()
    RETURNS TRIGGER AS $$
    DECLARE
        v_current_streak INTEGER;
    BEGIN
        IF NEW.event_type IN ('relapse', 'sexual_activity') THEN
            SELECT current_streak INTO v_current_streak FROM users WHERE user_id = NEW.user_id;
            
            IF v_current_streak > 0 THEN
                INSERT INTO streak_history (user_id, start_date, end_date, length_days, end_reason)
                VALUES (
                    NEW.user_id,
                    CURRENT_DATE - v_current_streak,
                    CURRENT_DATE,
                    v_current_streak,
                    NEW.event_type
                );
            END IF;
        END IF;
        
        RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`,

    `CREATE TRIGGER trigger_track_streak_history
    AFTER INSERT ON events
    FOR EACH ROW
    EXECUTE FUNCTION track_streak_on_relapse()`
];

async function createFunctions() {
    console.log('Creating remaining analytics functions...\n');

    for (let i = 0; i < functions.length; i++) {
        const func = functions[i];
        const preview = func.substring(0, 70).replace(/\s+/g, ' ');

        try {
            process.stdout.write(`[${i + 1}/${functions.length}] ${preview}... `);
            await sql(func);
            console.log('✅');
        } catch (error) {
            if (error.message.includes('already exists')) {
                console.log('⚠️  (already exists)');
            } else {
                console.log('❌');
                console.error(`   Error: ${error.message}`);
            }
        }
    }

    console.log('\n✨ All analytics functions created!');
}

createFunctions()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
