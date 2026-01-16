const { neon } = require('@neondatabase/serverless');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Connection string from environment
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL is missing in .env');
    process.exit(1);
}

const sql = neon(DATABASE_URL);

async function runMigrations() {
    console.log('🔌 Connecting to Neon Database...');

    try {
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');

        console.log('📖 Reading schema.sql...');

        const queries = schema
            .split(';')
            .map(q => q.trim())
            .filter(q => q.length > 0);

        console.log(`🚀 Found ${queries.length} queries to execute.`);

        for (let i = 0; i < queries.length; i++) {
            const query = queries[i];
            console.log(`Processing query ${i + 1}/${queries.length}...`);
            await sql(query);
        }

        console.log('✅ Migrations completed successfully!');

    } catch (error) {
        console.error('❌ Migration failed:', error);
    }
}

runMigrations();
