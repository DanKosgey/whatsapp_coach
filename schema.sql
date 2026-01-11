-- Users table
CREATE TABLE users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    whatsapp_number VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100),
    timezone VARCHAR(50) DEFAULT 'UTC',
    onboarding_completed BOOLEAN DEFAULT FALSE,
    current_streak INT DEFAULT 0,
    current_energy INT DEFAULT 0,
    last_relapse_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    preferences JSONB DEFAULT '{
        "check_in_times": ["09:00", "13:00", "17:00", "21:00"],
        "reminder_enabled": true,
        "language": "en"
    }'::jsonb
);

-- Daily logs from WhatsApp conversations
CREATE TABLE daily_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    log_date DATE NOT NULL,
    log_time TIME NOT NULL,
    
    -- Sentiment analysis results
    energy_level INT CHECK (energy_level BETWEEN 0 AND 10),
    mood_score INT CHECK (mood_score BETWEEN 0 AND 10),
    urges_intensity INT CHECK (urges_intensity BETWEEN 0 AND 10),
    stress_level INT CHECK (stress_level BETWEEN 0 AND 10),
    focus_quality INT CHECK (focus_quality BETWEEN 0 AND 10),
    
    -- Extracted from conversation
    raw_message TEXT,
    sentiment_positive FLOAT,
    sentiment_negative FLOAT,
    sentiment_compound FLOAT,
    
    -- Activities mentioned
    exercised BOOLEAN DEFAULT FALSE,
    meditated BOOLEAN DEFAULT FALSE,
    cold_shower BOOLEAN DEFAULT FALSE,
    
    -- Context
    triggers_mentioned TEXT[],
    accomplishments TEXT,
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- Conversation history with AI agent
CREATE TABLE conversations (
    conversation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    message_timestamp TIMESTAMP DEFAULT NOW(),
    sender VARCHAR(10) CHECK (sender IN ('user', 'agent')),
    message_text TEXT NOT NULL,
    message_type VARCHAR(20),
    ai_context JSONB,
    whatsapp_message_id VARCHAR(100), -- Store WhatsApp message ID
    created_at TIMESTAMP DEFAULT NOW()
);

-- Events (relapses, wins, etc.)
CREATE TABLE events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    event_type VARCHAR(20) CHECK (event_type IN ('relapse', 'sexual_activity', 'wet_dream', 'major_win')),
    event_timestamp TIMESTAMP DEFAULT NOW(),
    energy_impact INT,
    context_before TEXT,
    triggers TEXT[],
    emotional_state VARCHAR(50),
    recovery_plan_created BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Goals tracking
CREATE TABLE goals (
    goal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    category VARCHAR(50),
    target_date DATE,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
    milestones JSONB DEFAULT '[]'::jsonb,
    energy_allocated INT DEFAULT 0,
    reminder_frequency VARCHAR(20),
    last_reminded_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Energy transactions
CREATE TABLE energy_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    transaction_date TIMESTAMP DEFAULT NOW(),
    amount INT NOT NULL,
    source VARCHAR(50),
    description TEXT,
    running_balance INT,
    related_event_id UUID REFERENCES events(event_id)
);

-- Scheduled message queue
CREATE TABLE message_queue (
    queue_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    scheduled_time TIMESTAMP NOT NULL,
    message_type VARCHAR(30),
    message_content TEXT,
    sent BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- User analytics/insights cache
CREATE TABLE user_insights (
    insight_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(user_id) ON DELETE CASCADE,
    insight_date DATE DEFAULT CURRENT_DATE,
    insight_type VARCHAR(50),
    insight_data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_daily_logs_user_date ON daily_logs(user_id, log_date DESC);
CREATE INDEX idx_conversations_user_time ON conversations(user_id, message_timestamp DESC);
CREATE INDEX idx_events_user_type ON events(user_id, event_type, event_timestamp DESC);
CREATE INDEX idx_message_queue_scheduled ON message_queue(scheduled_time) WHERE sent = FALSE;
CREATE INDEX idx_goals_user_active ON goals(user_id) WHERE status = 'active';
