const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./db');
require('dotenv').config();

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Agent personality and system prompt
// Agent personas
const PERSONAS = {
    default: "You are a supportive, non-judgmental AI coach.",
    stoic: "You are a Stoic mentor. Focus on discipline, rationality, and control. Use quotes from Marcus Aurelius or Seneca. Be firm but calm.",
    drill: "You are a Drill Sergeant. Be tough, demanding, and high-energy. No excuses. Focus on strength and willpower. Use caps for emphasis.",
    friend: "You are an empathetic best friend. Be warm, caring, and gentle. Focus on feelings and emotional support.",
    analyst: "You are a Data Analyst. Focus on the numbers, streaks, and logical patterns. Be objective and precise."
};

const BASE_PROMPT = `Your role is to:
1. Ask questions to gather daily check-in data (energy, mood, urges, activities)
2. Provide encouragement and motivation
3. Remind users of their goals
4. Analyze patterns and give insights
5. Support them during difficult moments

Key principles:
- Be concise (WhatsApp/Telegram messages should be short - max 2-3 sentences)
- Use emojis sparingly but effectively
- Ask ONE question at a time
- Keep responses under 100 words`;

// Detect if message indicates relapse
// Detect if message indicates relapse
async function detectRelapseIntent(messageText) {
    const relapseKeywords = [
        'relapsed', 'failed', 'gave in', 'broke my streak', 'reset',
        'messed up', 'lost control', 'couldn\'t resist', 'slip up',
        'fell off', 'back to square one', 'started again'
    ];

    const lowerText = messageText.toLowerCase();

    // Quick keyword check first
    if (relapseKeywords.some(kw => lowerText.includes(kw))) return true;

    // AI check for nuance
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const prompt = `Analyze this message. Is the user reporting a relapse/failure in their celibacy streak? Reply YES or NO. Message: "${messageText}"`;
        const result = await model.generateContent(prompt);
        const response = result.response.text().trim().toUpperCase();
        return response.includes('YES');
    } catch (e) {
        return false;
    }
}

// Detect if message indicates major win
async function detectWinIntent(messageText) {
    const winKeywords = [
        'achieved', 'completed goal', 'won', 'success', 'milestone',
        'accomplished', 'finished', 'proud', 'breakthrough', 'victory',
        'hit my goal', 'reached', 'made it', 'did it'
    ];

    const lowerText = messageText.toLowerCase();
    // Quick keyword check
    if (winKeywords.some(kw => lowerText.includes(kw))) return true;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
        const prompt = `Analyze this message. Is the user reporting a significant success or goal completion? Reply YES or NO. Message: "${messageText}"`;
        const result = await model.generateContent(prompt);
        const response = result.response.text().trim().toUpperCase();
        return response.includes('YES');
    } catch (e) {
        return false;
    }
}

// Generate AI response using Gemini
async function generateAIResponse(userId, userMessage, messageType = 'casual') {
    try {
        // Get user context
        const user = await db.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        const userData = user[0];

        // Get recent conversation history
        const recentConversations = await db.getRecentConversations(userId, 5);

        // Get user's active goals
        const goals = await db.getUserGoals(userId);

        // Get today's logs
        const todayLogs = await db.query(
            `SELECT * FROM daily_logs 
             WHERE user_id = $1 AND log_date = CURRENT_DATE 
             ORDER BY log_time DESC LIMIT 1`,
            [userId]
        );

        // Build context
        const context = {
            name: userData.name || 'User',
            streak: userData.current_streak,
            energy: userData.current_energy,
            goals: goals.map(g => ({ title: g.title, target_date: g.target_date })),
            today_energy: todayLogs[0]?.energy_level,
            today_mood: todayLogs[0]?.mood_score,
        };

        // Build conversation history
        let conversationHistory = '';
        recentConversations.forEach(conv => {
            conversationHistory += `${conv.sender === 'user' ? 'User' : 'Assistant'}: ${conv.message_text}\n`;
        });

        // Determine Persona
        const personaKey = userData.preferences?.coach_persona || 'default';
        const personaPrompt = PERSONAS[personaKey] || PERSONAS.default;

        // Determine Risk Level (Simple heuristic based on time of day)
        const hour = new Date().getHours();
        let riskLevel = 'LOW';
        if (hour >= 22 || hour <= 2) riskLevel = 'HIGH'; // Late night
        if (userData.current_streak < 3) riskLevel = 'MEDIUM'; // Early streak

        const contextPrompt = `
USER CONTEXT:
- Name: ${context.name}
- Streak: ${context.streak} days
- Energy: ${context.energy}
- RISK LEVEL: ${riskLevel} (Time: ${hour}:00)
- Persona Mode: ${personaKey.toUpperCase()}

MESSAGE TYPE: ${messageType}

RECENT CONVERSATION:
${conversationHistory}

USER'S MESSAGE: ${userMessage}

INSTRUCTIONS:
Respond as the ${personaKey} persona.
${riskLevel === 'HIGH' ? 'WARNING: User is in a high-risk window (late night). Be extra vigilant.' : ''}
Keep it short.`;

        // Create full prompt
        const fullPrompt = `${personaPrompt}\n${BASE_PROMPT}\n\n${contextPrompt}`;

        // Initialize model
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

        // Generate response
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const aiResponse = response.text();

        // Save AI response to conversation history
        await db.saveConversation(userId, 'agent', aiResponse, messageType, {
            context_used: context,
            model: 'gemini-flash-latest'
        });

        return aiResponse.trim();

    } catch (error) {
        console.error('❌ Gemini AI generation error:', error);
        return "I'm having trouble connecting to my AI brain right now. Can you try again in a moment? 🙏";
    }
}

module.exports = {
    generateAIResponse,
    detectRelapseIntent,
    detectWinIntent
};
