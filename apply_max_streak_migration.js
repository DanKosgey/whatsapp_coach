const db = require('./db');

async function applyMigration() {
    console.log('Applying max_streak column migration...');

    try {
        // Add column
        console.log('Adding max_streak column...');
        await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS max_streak INT DEFAULT 0`);

        // Update existing users
        console.log('Updating existing users...');
        await db.query(`UPDATE users SET max_streak = current_streak WHERE max_streak < current_streak OR max_streak IS NULL`);

        // Create trigger function
        console.log('Creating trigger function...');
        await db.query(`
            CREATE OR REPLACE FUNCTION update_max_streak()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.current_streak > COALESCE(NEW.max_streak, 0) THEN
                    NEW.max_streak := NEW.current_streak;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);

        // Drop existing trigger if exists
        console.log('Dropping old trigger if exists...');
        await db.query(`DROP TRIGGER IF EXISTS trigger_update_max_streak ON users`);

        // Create trigger
        console.log('Creating trigger...');
        await db.query(`
            CREATE TRIGGER trigger_update_max_streak
            BEFORE UPDATE OF current_streak ON users
            FOR EACH ROW
            EXECUTE FUNCTION update_max_streak();
        `);

        console.log('✅ Successfully added max_streak column and trigger!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Failed to apply migration:', error);
        process.exit(1);
    }
}

applyMigration();
