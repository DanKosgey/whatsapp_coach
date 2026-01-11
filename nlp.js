const natural = require('natural');
const Analyzer = natural.SentimentAnalyzer;
const stemmer = natural.PorterStemmer;
const analyzer = new Analyzer("English", stemmer, "afinn");

/**
 * Analyze a message to extract metrics, sentiment, and activities
 * @param {string} text - Inherit message text
 * @returns {object} - Analyzed data
 */
function analyzeMessage(text) {
    const lowerText = text.toLowerCase();

    // 1. Sentiment Analysis
    const tokenizer = new natural.WordTokenizer();
    const tokenized = tokenizer.tokenize(text);
    const sentimentScore = analyzer.getSentiment(tokenized);

    // Normalize sentiment roughly to -1 to 1 range (Afinn usually returns integers)
    // This is an approximation.
    const sentimentCompound = Math.max(-1, Math.min(1, sentimentScore / 5));
    const sentimentPositive = sentimentCompound > 0 ? sentimentCompound : 0;
    const sentimentNegative = sentimentCompound < 0 ? Math.abs(sentimentCompound) : 0;

    // 2. Extract Explicit Metrics (Heuristic: "Energy 8", "Mood: 7", etc.)
    const metrics = {
        energy_level: extractMetric(lowerText, ['energy', 'power', 'charge']),
        mood_score: extractMetric(lowerText, ['mood', 'feeling', 'happy', 'sad']),
        urges_intensity: extractMetric(lowerText, ['urge', 'craving', 'desire']),
        stress_level: extractMetric(lowerText, ['stress', 'anxiety', 'worried']),
        focus_quality: extractMetric(lowerText, ['focus', 'concentration', 'work'])
    };

    // Default values if not found (optional, or leave null)
    // For now, if sentiment is very positive, boost mood if not specified
    if (!metrics.mood_score && sentimentCompound > 0.5) metrics.mood_score = 8;
    if (!metrics.mood_score && sentimentCompound < -0.5) metrics.mood_score = 3;

    // 3. Activity Detecion
    const exercised = hasKeywords(lowerText, ['workout', 'gym', 'exercise', 'run', 'lifting', 'cardio']);
    const meditated = hasKeywords(lowerText, ['meditate', 'meditation', 'mindfulness', 'breathwork']);
    const cold_shower = hasKeywords(lowerText, ['cold shower', 'ice bath', 'cold water']);

    // 4. Context Extraction
    const triggers_mentioned = extractTriggers(lowerText);
    const accomplishments = extractAccomplishments(text);

    return {
        raw_message: text,
        sentiment_positive: sentimentPositive,
        sentiment_negative: sentimentNegative,
        sentiment_compound: sentimentCompound,
        ...metrics,
        exercised,
        meditated,
        cold_shower,
        triggers_mentioned,
        accomplishments
    };
}

// Helper: Extract number associated with keywords (e.g. "Energy: 7/10")
function extractMetric(text, keywords) {
    for (const keyword of keywords) {
        // Regex looks for keyword followed by optional colon/space and a number 1-10
        const regex = new RegExp(`${keyword}[:\\s-]*(\\d{1,2})`, 'i');
        const match = text.match(regex);
        if (match && match[1]) {
            let val = parseInt(match[1]);
            if (val > 10) val = 10; // Cap at 10
            return val;
        }
    }
    return null;
}

// Helper: Check for keywords
function hasKeywords(text, keywords) {
    return keywords.some(kw => text.includes(kw));
}

// Helper: Extract potential triggers
function extractTriggers(text) {
    const commonTriggers = ['boredom', 'stress', 'loneliness', 'instagram', 'tiktok', 'late night', 'tired', 'alcohol'];
    return commonTriggers.filter(trigger => text.includes(trigger));
}

// Helper: Simple extraction for phrases after "win:" or "accomplished:"
function extractAccomplishments(text) {
    const regex = /(?:win|accomplishment|proud of)[:\s]+(.*?)(?:\.|$)/i;
    const match = text.match(regex);
    return match ? match[1].trim() : null;
}

module.exports = {
    analyzeMessage
};
