-- Add Telegram fields to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_id BIGINT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_channel VARCHAR(20) DEFAULT 'whatsapp';
ALTER TABLE users ALTER COLUMN whatsapp_number DROP NOT NULL;

-- Add Telegram message ID/platform to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS platform VARCHAR(20) DEFAULT 'whatsapp';
