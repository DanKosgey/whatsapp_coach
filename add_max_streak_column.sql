-- Add max_streak column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS max_streak INT DEFAULT 0;

-- Update max_streak for existing users based on their current_streak
UPDATE users SET max_streak = current_streak WHERE max_streak < current_streak OR max_streak IS NULL;

-- Create a trigger to automatically update max_streak when current_streak changes
CREATE OR REPLACE FUNCTION update_max_streak()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.current_streak > COALESCE(NEW.max_streak, 0) THEN
        NEW.max_streak := NEW.current_streak;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_max_streak ON users;
CREATE TRIGGER trigger_update_max_streak
BEFORE UPDATE OF current_streak ON users
FOR EACH ROW
EXECUTE FUNCTION update_max_streak();
