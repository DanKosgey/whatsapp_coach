-- =====================================================
-- ANALYTICS DATABASE SCHEMA
-- Supports 6 analytical models for the Analytics screen
-- =====================================================

-- =====================================================
-- 1. NEW TABLES
-- =====================================================

-- Daily aggregated metrics per user
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
);

CREATE INDEX idx_daily_aggregates_user_date ON daily_aggregates(user_id, date DESC);

-- Streak history tracking
CREATE TABLE IF NOT EXISTS streak_history (
    streak_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE,
    length_days INTEGER,
    end_reason VARCHAR(50), -- 'relapse', 'sexual_activity', 'ongoing'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_streak_history_user ON streak_history(user_id, start_date DESC);

-- Risk factors time-series
CREATE TABLE IF NOT EXISTS risk_factors (
    risk_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hour_of_day INTEGER CHECK (hour_of_day >= 0 AND hour_of_day < 24),
    day_of_week INTEGER CHECK (day_of_week >= 0 AND day_of_week < 7),
    urge_level DECIMAL(3,1),
    stress_level DECIMAL(3,1),
    mood_score DECIMAL(3,1),
    context TEXT,
    triggered BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_risk_factors_user_time ON risk_factors(user_id, timestamp DESC);

-- =====================================================
-- 2. MATERIALIZED VIEWS
-- =====================================================

-- User discipline metrics (refreshed hourly)
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
    
    -- Streak Stability: current_streak / (current_streak + days_since_last_relapse)
    CASE 
        WHEN u.current_streak = 0 THEN 0
        ELSE u.current_streak::DECIMAL / 
             (u.current_streak + COALESCE(
                 (SELECT CURRENT_DATE - MAX(event_timestamp)::DATE 
                  FROM events 
                  WHERE user_id = u.user_id 
                  AND event_type = 'relapse'), 
                 u.current_streak
             ))
    END AS streak_stability,
    
    -- Activity Adherence: days with activities / check-in days
    COALESCE(
        (SELECT COUNT(*) 
         FROM daily_logs 
         WHERE user_id = u.user_id 
         AND (exercised = TRUE OR meditated = TRUE OR cold_shower = TRUE)
         AND log_date >= CURRENT_DATE - INTERVAL '30 days')::DECIMAL /
        NULLIF((SELECT COUNT(DISTINCT log_date) 
                FROM daily_logs 
                WHERE user_id = u.user_id 
                AND log_date >= CURRENT_DATE - INTERVAL '30 days'), 0),
        0
    ) AS activity_adherence,
    
    -- Goal Progress: completed goals / total goals
    COALESCE(
        (SELECT COUNT(*) 
         FROM goals 
         WHERE user_id = u.user_id 
         AND status = 'completed')::DECIMAL /
        NULLIF((SELECT COUNT(*) FROM goals WHERE user_id = u.user_id), 0),
        0
    ) AS goal_progress,
    
    CURRENT_TIMESTAMP AS last_updated
FROM users u;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_discipline_user ON mv_user_discipline_metrics(user_id);

-- 7-day energy flow breakdown
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_energy_flow_7d AS
SELECT 
    u.user_id,
    -- Base daily energy (always 10)
    10 AS base_daily,
    
    -- Streak bonus calculation
    CASE 
        WHEN u.current_streak <= 7 THEN 2 * u.current_streak
        ELSE 5 * (u.current_streak - 7) + 14
    END AS streak_bonus,
    
    -- Activity bonus from last 7 days
    COALESCE(
        (SELECT SUM(
            CASE WHEN exercised THEN 20 ELSE 0 END +
            CASE WHEN meditated THEN 15 ELSE 0 END +
            CASE WHEN cold_shower THEN 10 ELSE 0 END
        )
        FROM daily_logs
        WHERE user_id = u.user_id
        AND log_date >= CURRENT_DATE - INTERVAL '7 days'), 
        0
    ) AS activity_bonus,
    
    -- Losses from events
    COALESCE(
        (SELECT ABS(SUM(energy_impact))
         FROM events
         WHERE user_id = u.user_id
         AND energy_impact < 0
         AND event_timestamp >= CURRENT_DATE - INTERVAL '7 days'),
        0
    ) AS losses,
    
    u.current_energy,
    CURRENT_TIMESTAMP AS last_updated
FROM users u;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_energy_flow_user ON mv_energy_flow_7d(user_id);

-- Survival probabilities (Kaplan-Meier estimates)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_survival_probabilities AS
WITH streak_data AS (
    SELECT 
        user_id,
        length_days,
        CASE WHEN end_reason IS NULL THEN 1 ELSE 0 END AS censored
    FROM streak_history
    WHERE length_days IS NOT NULL
),
milestone_survival AS (
    SELECT 
        user_id,
        -- Day 7 survival
        (SELECT COUNT(*) FROM streak_data sd2 
         WHERE sd2.user_id = sd.user_id AND sd2.length_days >= 7)::DECIMAL /
        NULLIF(COUNT(*), 0) AS survival_day_7,
        
        -- Day 30 survival
        (SELECT COUNT(*) FROM streak_data sd2 
         WHERE sd2.user_id = sd.user_id AND sd2.length_days >= 30)::DECIMAL /
        NULLIF(COUNT(*), 0) AS survival_day_30,
        
        -- Day 90 survival
        (SELECT COUNT(*) FROM streak_data sd2 
         WHERE sd2.user_id = sd.user_id AND sd2.length_days >= 90)::DECIMAL /
        NULLIF(COUNT(*), 0) AS survival_day_90,
        
        -- Median survival time
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY length_days) AS median_survival,
        
        COUNT(*) AS total_attempts
    FROM streak_data sd
    GROUP BY user_id
)
SELECT * FROM milestone_survival;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_survival_user ON mv_survival_probabilities(user_id);

-- =====================================================
-- 3. POSTGRESQL FUNCTIONS
-- =====================================================

-- Calculate Productivity Index
-- Formula: PI = α × ln(1 + E/E₀) + β × D
CREATE OR REPLACE FUNCTION calculate_productivity_index(p_user_id UUID)
RETURNS TABLE(
    productivity_index DECIMAL,
    focus_hours DECIMAL,
    output_multiplier DECIMAL,
    zone TEXT
) AS $$
DECLARE
    v_energy INTEGER;
    v_discipline DECIMAL;
    v_pi DECIMAL;
    v_alpha CONSTANT DECIMAL := 15;
    v_beta CONSTANT DECIMAL := 10;
    v_e0 CONSTANT DECIMAL := 100;
BEGIN
    -- Get current energy
    SELECT current_energy INTO v_energy FROM users WHERE user_id = p_user_id;
    
    -- Get discipline score
    SELECT (
        consistency * 0.25 + 
        streak_stability * 0.40 + 
        activity_adherence * 0.20 + 
        goal_progress * 0.15
    ) INTO v_discipline
    FROM mv_user_discipline_metrics
    WHERE user_id = p_user_id;
    
    -- Calculate PI
    v_pi := v_alpha * LN(1 + v_energy::DECIMAL / v_e0) + v_beta * COALESCE(v_discipline, 0);
    
    RETURN QUERY SELECT 
        v_pi,
        v_pi * 0.5 AS focus_hours,
        1 + (v_energy - 50)::DECIMAL / 500 AS output_multiplier,
        CASE 
            WHEN v_pi < 10 THEN 'Recovery'
            WHEN v_pi < 20 THEN 'Normal'
            WHEN v_pi < 30 THEN 'Enhanced'
            WHEN v_pi < 40 THEN 'Peak'
            ELSE 'Superhuman'
        END AS zone;
END;
$$ LANGUAGE plpgsql;

-- Calculate Discipline Score
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
    
    RETURN QUERY SELECT 
        v_score,
        CASE 
            WHEN v_score >= 90 THEN 'S'
            WHEN v_score >= 80 THEN 'A'
            WHEN v_score >= 70 THEN 'B'
            WHEN v_score >= 60 THEN 'C'
            ELSE 'D'
        END,
        consistency,
        streak_stability,
        activity_adherence,
        goal_progress;
END;
$$ LANGUAGE plpgsql;

-- Predict Relapse Risk (Logistic Regression)
CREATE OR REPLACE FUNCTION predict_relapse_risk(p_user_id UUID)
RETURNS TABLE(
    risk_probability DECIMAL,
    risk_level TEXT,
    factors JSONB
) AS $$
DECLARE
    v_hour INTEGER := EXTRACT(HOUR FROM CURRENT_TIMESTAMP);
    v_streak INTEGER;
    v_recent_urges DECIMAL;
    v_recent_stress DECIMAL;
    v_exercised_today BOOLEAN;
    v_z DECIMAL := 0;
    v_prob DECIMAL;
    v_factors JSONB;
BEGIN
    -- Get user data
    SELECT current_streak INTO v_streak FROM users WHERE user_id = p_user_id;
    
    -- Get recent urges and stress
    SELECT AVG(urges_intensity), AVG(stress_level)
    INTO v_recent_urges, v_recent_stress
    FROM daily_logs
    WHERE user_id = p_user_id
    AND log_date >= CURRENT_DATE - INTERVAL '3 days';
    
    -- Check if exercised today
    SELECT COALESCE(exercised, FALSE) INTO v_exercised_today
    FROM daily_logs
    WHERE user_id = p_user_id AND log_date = CURRENT_DATE
    LIMIT 1;
    
    -- Calculate logistic regression z-score
    -- Intercept
    v_z := -2.0;
    
    -- Late night risk (22:00-02:00)
    IF v_hour >= 22 OR v_hour <= 2 THEN
        v_z := v_z + 1.2;
    END IF;
    
    -- High urges
    IF v_recent_urges > 7 THEN
        v_z := v_z + 0.8;
    END IF;
    
    -- High stress
    IF v_recent_stress > 7 THEN
        v_z := v_z + 0.6;
    END IF;
    
    -- Early streak
    IF v_streak < 7 THEN
        v_z := v_z + 0.5;
    END IF;
    
    -- Exercise protection
    IF v_exercised_today THEN
        v_z := v_z - 0.7;
    END IF;
    
    -- Calculate probability: P = 1 / (1 + e^(-z))
    v_prob := 1.0 / (1.0 + EXP(-v_z));
    
    -- Build factors JSON
    v_factors := jsonb_build_array(
        jsonb_build_object(
            'name', 'Time of Day',
            'impact', CASE WHEN v_hour >= 22 OR v_hour <= 2 THEN 'high_risk' ELSE 'low_risk' END,
            'description', 'Current hour: ' || v_hour || ':00'
        ),
        jsonb_build_object(
            'name', 'Urge Level',
            'impact', CASE WHEN v_recent_urges > 7 THEN 'high_risk' WHEN v_recent_urges > 4 THEN 'medium_risk' ELSE 'low_risk' END,
            'description', 'Recent average: ' || COALESCE(ROUND(v_recent_urges, 1), 0) || '/10'
        ),
        jsonb_build_object(
            'name', 'Stress Level',
            'impact', CASE WHEN v_recent_stress > 7 THEN 'high_risk' WHEN v_recent_stress > 4 THEN 'medium_risk' ELSE 'low_risk' END,
            'description', 'Recent average: ' || COALESCE(ROUND(v_recent_stress, 1), 0) || '/10'
        ),
        jsonb_build_object(
            'name', 'Exercise Today',
            'impact', CASE WHEN v_exercised_today THEN 'protection' ELSE 'medium_risk' END,
            'description', CASE WHEN v_exercised_today THEN 'Dopamine baseline stabilized' ELSE 'No exercise logged today' END
        )
    );
    
    RETURN QUERY SELECT 
        v_prob,
        CASE 
            WHEN v_prob > 0.8 THEN 'CRITICAL'
            WHEN v_prob > 0.5 THEN 'HIGH'
            WHEN v_prob > 0.2 THEN 'MODERATE'
            ELSE 'LOW'
        END,
        v_factors;
END;
$$ LANGUAGE plpgsql;

-- Get Survival Curve Data
CREATE OR REPLACE FUNCTION get_survival_curve(p_user_id UUID)
RETURNS TABLE(
    current_streak INTEGER,
    max_streak INTEGER,
    median_survival DECIMAL,
    survival_day_7 DECIMAL,
    survival_day_30 DECIMAL,
    survival_day_90 DECIMAL,
    total_attempts INTEGER,
    danger_zones TEXT[]
) AS $$
DECLARE
    v_current INTEGER;
    v_max INTEGER;
BEGIN
    -- Get current and max streak
    SELECT u.current_streak, u.max_streak INTO v_current, v_max
    FROM users u WHERE u.user_id = p_user_id;
    
    -- Get survival data and danger zones
    RETURN QUERY
    WITH danger_buckets AS (
        SELECT 
            (length_days / 5) * 5 AS bucket_start,
            COUNT(*) AS failures
        FROM streak_history
        WHERE user_id = p_user_id
        AND end_reason IS NOT NULL
        GROUP BY bucket_start
        ORDER BY failures DESC
        LIMIT 2
    )
    SELECT 
        v_current,
        v_max,
        COALESCE(sp.median_survival, 0),
        COALESCE(sp.survival_day_7, 1.0),
        COALESCE(sp.survival_day_30, 1.0),
        COALESCE(sp.survival_day_90, 1.0),
        COALESCE(sp.total_attempts, 0)::INTEGER,
        ARRAY(
            SELECT 'Days ' || bucket_start || '-' || (bucket_start + 4)
            FROM danger_buckets
        ) AS danger_zones
    FROM mv_survival_probabilities sp
    WHERE sp.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql;

-- Get Recovery Phase
CREATE OR REPLACE FUNCTION get_recovery_phase(p_streak_days INTEGER)
RETURNS TABLE(
    phase TEXT,
    phase_number INTEGER,
    progress_percent DECIMAL,
    dopamine_recovery DECIMAL,
    androgen_sensitivity DECIMAL,
    prefrontal_changes DECIMAL,
    description TEXT
) AS $$
BEGIN
    RETURN QUERY SELECT 
        CASE 
            WHEN p_streak_days < 7 THEN 'Withdrawal'
            WHEN p_streak_days < 30 THEN 'Stabilization'
            WHEN p_streak_days < 90 THEN 'Momentum'
            ELSE 'Transformation'
        END,
        CASE 
            WHEN p_streak_days < 7 THEN 1
            WHEN p_streak_days < 30 THEN 2
            WHEN p_streak_days < 90 THEN 3
            ELSE 4
        END,
        CASE 
            WHEN p_streak_days < 7 THEN (p_streak_days::DECIMAL / 7) * 100
            WHEN p_streak_days < 30 THEN ((p_streak_days - 7)::DECIMAL / 23) * 100
            WHEN p_streak_days < 90 THEN ((p_streak_days - 30)::DECIMAL / 60) * 100
            ELSE 100.0
        END,
        LEAST(p_streak_days::DECIMAL / 90 * 100, 100.0),
        CASE WHEN p_streak_days >= 8 THEN LEAST((p_streak_days - 7)::DECIMAL / 23 * 20, 20.0) ELSE 0 END,
        CASE WHEN p_streak_days >= 31 THEN LEAST((p_streak_days - 30)::DECIMAL / 60 * 30, 30.0) ELSE 0 END,
        CASE 
            WHEN p_streak_days < 7 THEN 'Dopamine receptors beginning to upregulate'
            WHEN p_streak_days < 30 THEN 'Androgen sensitivity increasing 10-15%'
            WHEN p_streak_days < 90 THEN 'Prefrontal cortex showing structural changes'
            ELSE 'Full neurochemical reset achieved'
        END;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 4. REFRESH FUNCTIONS
-- =====================================================

-- Refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_discipline_metrics;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_energy_flow_7d;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_survival_probabilities;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. TRIGGERS FOR AUTO-AGGREGATION
-- =====================================================

-- Auto-create daily aggregate when daily_log is inserted
CREATE OR REPLACE FUNCTION update_daily_aggregates()
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_daily_aggregates
AFTER INSERT ON daily_logs
FOR EACH ROW
EXECUTE FUNCTION update_daily_aggregates();

-- Auto-track streak history on relapse
CREATE OR REPLACE FUNCTION track_streak_on_relapse()
RETURNS TRIGGER AS $$
DECLARE
    v_current_streak INTEGER;
BEGIN
    IF NEW.event_type IN ('relapse', 'sexual_activity') THEN
        -- Get current streak before it's reset
        SELECT current_streak INTO v_current_streak FROM users WHERE user_id = NEW.user_id;
        
        -- Only log if there was an active streak
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_track_streak_history
AFTER INSERT ON events
FOR EACH ROW
EXECUTE FUNCTION track_streak_on_relapse();
