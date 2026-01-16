const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
require('dotenv').config();

const sql = neon(process.env.DATABASE_URL);

async function runAnalyticsMigration() {
    console.log('🚀 Starting analytics schema migration...\n');

    const schema = fs.readFileSync('./analytics_schema.sql', 'utf8');

    // Better parsing: split by statement terminators but preserve function bodies
    const statements = [];
    let current = '';
    let inFunction = false;

    const lines = schema.split('\n');
    for (const line of lines) {
        const trimmed = line.trim();

        // Skip comments and empty lines at statement boundaries
        if (!current && (trimmed.startsWith('--') || !trimmed)) continue;

        // Track function boundaries
        if (trimmed.match(/CREATE (OR REPLACE )?FUNCTION/i)) {
            inFunction = true;
        }
        if (inFunction && trimmed.match(/\$\$ LANGUAGE/i)) {
            current += line + '\n';
            inFunction = false;
            continue;
        }

        current += line + '\n';

        // End of statement: semicolon outside of function body
        if (!inFunction && trimmed.endsWith(';')) {
            const stmt = current.trim();
            if (stmt && !stmt.startsWith('--')) {
                statements.push(stmt);
            }
            current = '';
        }
    }

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];

        try {
            // Show what we're executing
            const firstLine = stmt.split('\n')[0].substring(0, 70).replace(/\s+/g, ' ');
            process.stdout.write(`[${i + 1}/${statements.length}] ${firstLine}...`);

            await sql(stmt);
            console.log(' ✅');
            successCount++;
        } catch (error) {
            console.log(` ❌`);
            console.error(`   Error: ${error.message}`);

            // Continue on "already exists" errors
            if (!error.message.includes('already exists') &&
                error.code !== '42P07' && // relation already exists
                error.code !== '42710') { // object already exists
                errorCount++;
            }
        }
    }

    console.log(`\n📊 Migration complete:`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);

    // Refresh materialized views
    console.log('\n🔄 Refreshing materialized views...');
    try {
        await sql`SELECT refresh_analytics_views()`;
        console.log('   ✅ Views refreshed successfully');
    } catch (error) {
        console.log(`   ⚠️  View refresh skipped: ${error.message}`);
    }
}

runAnalyticsMigration()
    .then(() => {
        console.log('\n✨ Analytics schema ready!');
        process.exit(0);
    })
    .catch(err => {
        console.error('\n❌ Migration failed:', err);
        process.exit(1);
    });
