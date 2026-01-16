const db = require('./db');

async function applyMissingFunctions() {
    console.log('Applying missing analytics functions...');

    try {
        // 1. Predict Relapse Risk Function
        console.log('Creating predict_relapse_risk()...');
        await db.query(`
            CREATE OR REPLACE FUNCTION predict_relapse_risk(p_user_id UUID)
            RETURNS TABLE (
                risk_probability DECIMAL,
                risk_level VARCHAR,
                factors JSONB
            ) AS $$
            DECLARE
                v_streak INT;
                v_hour INT;
                v_avg_stress DECIMAL;
                v_risk_score DECIMAL := 0.2;
                v_factors JSONB := '[]'::jsonb;
            BEGIN
                SELECT current_streak INTO v_streak FROM users WHERE user_id = p_user_id;
                v_hour := EXTRACT(HOUR FROM NOW());
                
                SELECT AVG(stress_level) INTO v_avg_stress 
                FROM daily_logs 
                WHERE user_id = p_user_id AND log_date >= CURRENT_DATE - 3;
                
                IF v_hour >= 22 OR v_hour <= 4 THEN
                    v_risk_score := v_risk_score + 0.35;
                    v_factors := v_factors || jsonb_build_object('name', 'Late Night Hours', 'impact', 'high_risk', 'description', 'Willpower is lowest during late night hours');
                END IF;

                IF v_streak < 7 THEN
                    v_risk_score := v_risk_score + 0.25;
                    v_factors := v_factors || jsonb_build_object('name', 'Early Streak Phase', 'impact', 'medium_risk', 'description', 'First 7 days have highest relapse rates');
                ELSIF v_streak > 30 THEN
                    v_risk_score := v_risk_score - 0.15;
                    v_factors := v_factors || jsonb_build_object('name', 'Habit Formation', 'impact', 'protection', 'description', 'Strong momentum protects against impulses');
                END IF;

                IF v_avg_stress > 7 THEN
                    v_risk_score := v_risk_score + 0.20;
                    v_factors := v_factors || jsonb_build_object('name', 'High Stress Levels', 'impact', 'high_risk', 'description', 'Recent high stress correlates with relapse');
                END IF;

                IF v_risk_score > 0.95 THEN v_risk_score := 0.95; END IF;
                IF v_risk_score < 0.05 THEN v_risk_score := 0.05; END IF;

                IF v_risk_score > 0.7 THEN risk_level := 'CRITICAL';
                ELSIF v_risk_score > 0.4 THEN risk_level := 'MODERATE';
                ELSE risk_level := 'LOW';
                END IF;

                risk_probability := v_risk_score;
                RETURN NEXT;
            END;
            $$ LANGUAGE plpgsql;
        `);

        // 2. Get Survival Curve Function
        console.log('Creating get_survival_curve()...');
        await db.query(`
            CREATE OR REPLACE FUNCTION get_survival_curve(p_user_id UUID)
            RETURNS TABLE (
                current_streak INT,
                max_streak INT,
                total_attempts INT,
                median_survival DECIMAL,
                survival_day_7 DECIMAL,
                survival_day_30 DECIMAL,
                survival_day_90 DECIMAL,
                danger_zones JSONB
            ) AS $$
            DECLARE
                v_attempts INT;
                v_avg_length DECIMAL;
                v_current_streak INT;
                v_max_streak INT;
            BEGIN
                -- Use local variables to avoid ambiguity with output parameter names
                SELECT u.current_streak, u.max_streak INTO v_current_streak, v_max_streak 
                FROM users u WHERE u.user_id = p_user_id;

                SELECT COUNT(*), AVG(length_days) 
                INTO v_attempts, v_avg_length 
                FROM streak_history 
                WHERE user_id = p_user_id;

                total_attempts := COALESCE(v_attempts, 0);
                
                IF total_attempts < 3 THEN
                    median_survival := 14.0;
                    survival_day_7 := 0.85;
                    survival_day_30 := 0.40;
                    survival_day_90 := 0.15;
                    danger_zones := '[{"day": 3, "risk": "high"}, {"day": 7, "risk": "high"}, {"day": 30, "risk": "medium"}]'::jsonb;
                ELSE
                    median_survival := COALESCE(v_avg_length, 7.0);
                    survival_day_7 := EXP(-7.0 / median_survival);
                    survival_day_30 := EXP(-30.0 / median_survival);
                    survival_day_90 := EXP(-90.0 / median_survival);
                    
                    SELECT jsonb_agg(jsonb_build_object('day', length_days, 'risk', 'high'))
                    INTO danger_zones
                    FROM (
                        SELECT length_days, COUNT(*) as cnt 
                        FROM streak_history 
                        WHERE user_id = p_user_id 
                        GROUP BY length_days 
                        ORDER BY cnt DESC 
                        LIMIT 3
                    ) t;
                END IF;

                -- Assign to return columns
                current_streak := v_current_streak;
                max_streak := v_max_streak;

                RETURN NEXT;
            END;
            $$ LANGUAGE plpgsql;
        `);

        // 3. Get Recovery Phase Function
        console.log('Creating get_recovery_phase()...');
        await db.query(`
            CREATE OR REPLACE FUNCTION get_recovery_phase(p_streak INT)
            RETURNS TABLE (
                phase VARCHAR,
                phase_number INT,
                progress_percent DECIMAL,
                dopamine_recovery DECIMAL,
                androgen_sensitivity DECIMAL,
                prefrontal_changes DECIMAL,
                description VARCHAR
            ) AS $$
            BEGIN
                IF p_streak < 7 THEN
                    phase := 'Withdrawal';
                    phase_number := 1;
                    progress_percent := (p_streak::DECIMAL / 7.0) * 100;
                    dopamine_recovery := 10 + (p_streak * 2);
                    androgen_sensitivity := 0;
                    prefrontal_changes := 0;
                    description := 'Dopamine receptors beginning to upregulate. Strongest urges.';
                ELSIF p_streak < 30 THEN
                    phase := 'Stabilization';
                    phase_number := 2;
                    progress_percent := ((p_streak - 7)::DECIMAL / 23.0) * 100;
                    dopamine_recovery := 25 + ((p_streak - 7) * 1.5);
                    androgen_sensitivity := LEAST(100, (p_streak - 7) * 4);
                    prefrontal_changes := 5 + (p_streak * 0.5);
                    description := 'Androgen sensitivity increasing. Energy fluctuations stabilizing.';
                ELSIF p_streak < 90 THEN
                    phase := 'Momentum';
                    phase_number := 3;
                    progress_percent := ((p_streak - 30)::DECIMAL / 60.0) * 100;
                    dopamine_recovery := 60 + ((p_streak - 30) * 0.5);
                    androgen_sensitivity := 100;
                    prefrontal_changes := 20 + ((p_streak - 30) * 0.8);
                    description := 'Prefrontal cortex showing structural changes. Executive control improves.';
                ELSE
                    phase := 'Transformation';
                    phase_number := 4;
                    progress_percent := 100;
                    dopamine_recovery := 100;
                    androgen_sensitivity := 100;
                    prefrontal_changes := 100;
                    description := 'Full neurochemical reset achieved. New baseline established.';
                END IF;
                
                RETURN NEXT;
            END;
            $$ LANGUAGE plpgsql;
        `);

        console.log('✅ Successfully applied all missing analytics functions!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Failed to apply functions:', error);
        process.exit(1);
    }
}

applyMissingFunctions();
