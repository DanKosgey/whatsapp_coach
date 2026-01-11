const { GoogleGenerativeAI } = require('@google/generative-ai');
const db = require('./db');
require('dotenv').config();

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Agent personality and system prompt
const SYSTEM_PROMPT = `You are a supportive, non-judgmental AI coach helping users track their celibacy journey and personal growth. Your role is to:

1. Ask questions to gather daily check-in data (energy, mood, urges, activities)
2. Provide encouragement and motivation
3. Remind users of their goals
4. Analyze patterns and give insights
5. Support them during difficult moments

Key principles:
- Be concise (WhatsApp messages should be short - max 2-3 sentences)
- Use emojis sparingly but effectively (1-2 per message max)
- Never judge relapses - be supportive and constructive
- Ask ONE question at a time
- Celebrate wins enthusiastically but briefly
- Use the user's name when you know it
- Keep responses under 100 words
- Be warm, encouraging, and direct

Current context will be provided about the user's streak, energy, and recent activity.`;

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
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
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
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
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

        // Create context-aware prompt
        const contextPrompt = `
USER CONTEXT:
- Name: ${context.name}
- Current streak: ${context.streak} days
- Current energy: ${context.energy} points
- Active goals: ${context.goals.length > 0 ? context.goals.map(g => g.title).join(', ') : 'None set'}
- Today's check-in: ${context.today_energy ? `Energy ${context.today_energy}/10, Mood ${context.today_mood}/10` : 'Not yet completed'}

MESSAGE TYPE: ${messageType}

${messageType === 'check_in' ? 'This is a scheduled check-in. Ask about their current state (energy, mood). Be brief and friendly.' : ''}
${messageType === 'goal_reminder' ? 'Remind them of their goals and ask about progress. Be motivating but concise.' : ''}
${messageType === 'emergency' ? 'User may be struggling. Provide immediate support and ONE simple coping strategy (e.g., deep breathing, phone down).' : ''}
${messageType === 'celebration' ? 'User achieved something! Celebrate briefly and ask what helped them succeed.' : ''}

RECENT CONVERSATION:
${conversationHistory}

USER'S CURRENT MESSAGE: ${userMessage}

Respond naturally and helpfully as the Celibacy Coach. Keep it under 100 words and 2-3 sentences maximum.`;

        // Initialize Gemini model (using gemini-pro for text)
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });

        // Create full prompt
        const fullPrompt = `${SYSTEM_PROMPT}\n\n${contextPrompt}`;

        // Generate response
        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const aiResponse = response.text();

        // Save AI response to conversation history
        await db.saveConversation(userId, 'agent', aiResponse, messageType, {
            context_used: context,
            model: 'gemini-pro'
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
