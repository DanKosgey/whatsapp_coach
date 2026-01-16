const axios = require('axios');
require('dotenv').config();

const GOOGLE_API_KEY = process.env.GEMINI_API_KEY;

async function checkModels() {
    console.log('🔍 Checking available Gemini models...');
    try {
        const response = await axios.get(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_API_KEY}`
        );
        console.log('✅ Available Models:');
        response.data.models.forEach(m => {
            // Filter for 'generateContent' support
            if (m.supportedGenerationMethods.includes('generateContent')) {
                console.log(`- ${m.name}`);
            }
        });
    } catch (error) {
        console.error('❌ Failed to fetch models:', error.response ? error.response.data : error.message);
    }
}

checkModels();
