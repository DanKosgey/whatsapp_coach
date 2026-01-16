const { Telegraf, Markup, session } = require('telegraf');
const db = require('./db');
const nlp = require('./nlp');
const aiAgent = require('./ai-agent');
const menus = require('./telegram-menus');
require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
bot.use(session());

// Middleware to get or create user
bot.use(async (ctx, next) => {
    if (ctx.from) {
        let user = await db.getUserByTelegramId(ctx.from.id);

        if (!user) {
            user = await db.createTelegramUser(
                ctx.from.id,
                ctx.from.username,
                ctx.from.first_name,
                ctx.from.last_name
            );
            console.log(`✨ New Telegram user created: ${user.name}`);
        }

        ctx.state.user = user;
    }

    return next();
});

// --- Menu Handlers ---

bot.hears('⚡ Check-in', async (ctx) => {
    await ctx.reply('How\'s your energy level today? ⚡', menus.CheckInMenu);
});

bot.hears('🆘 SOS', async (ctx) => {
    await ctx.reply('🛑 EMERGENCY PROTOCOL: What\'s happening?', menus.SOSMenu);
});

bot.hears('📊 Stats', async (ctx) => {
    await handleStatsRequest(ctx);
});

bot.hears('🎯 Goals', async (ctx) => {
    await handleGoalsRequest(ctx);
});

bot.hears('⚙️ Settings', async (ctx) => {
    await ctx.reply('⚙️ Settings:', Markup.inlineKeyboard([
        [Markup.button.callback('🔔 Notifications', 'pref_notifs')],
        [Markup.button.callback('📱 Channel', 'preferences')]
    ]));
});

bot.hears('🧘 Coach Mode', async (ctx) => {
    const user = ctx.state.user;
    const currentMode = user.preferences?.coach_persona || 'default';
    await ctx.reply(`🧠 Current Persona: *${currentMode}*\n\nChoose your coach personality:`, {
        parse_mode: 'Markdown',
        ...menus.CoachModeMenu
    });
});

// Command: /start
bot.command('start', async (ctx) => {
    const user = ctx.state.user;
    const firstName = ctx.from.first_name;

    // Set persistent menu commands
    await ctx.setMyCommands([
        { command: 'start', description: 'Restart bot' },
        { command: 'checkin', description: 'Daily check-in' },
        { command: 'stats', description: 'View stats' },
        { command: 'SOS', description: 'Emergency help' },
        { command: 'goals', description: 'Manage goals' }
    ]);

    const welcomeMessage = `Hey ${firstName}! 👋

Welcome to your *Discipline Journey Tracker* 🎯

I'm here to support you every step of the way. I can help you:

🔥 Track your streak
⚡ Monitor your energy levels
😊 Log your daily mood
🎯 Set and achieve goals
📊 Get insights and analytics
💪 Stay motivated

*Quick Start:*
Use the menu below to navigate or type /help for commands.

Let's start with a quick check-in! How are you feeling right now? 😊`;

    await ctx.replyWithMarkdown(welcomeMessage, menus.MainMenu);
});

// Command: /help
bot.command('help', async (ctx) => {
    const helpMessage = `*Available Commands:* 📋

*Daily Tracking:*
/checkin - Quick check-in
/moodpoll - Poll based check-in

*Progress & Stats:*
/stats - View your statistics
/streak - See your current streak

*Goals:*
/goals - View active goals
/addgoal - Add a new goal

*Events:*
/relapse - Log a relapse
/win - Celebrate a victory

*Settings:*
/preferences - Switch platform preference

*Advanced:*
Send me a photo 📸 or use me in other chats via @${ctx.botInfo?.username} inline!`;

    await ctx.replyWithMarkdown(helpMessage);
});

// Command: /checkin
bot.command('checkin', async (ctx) => {
    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('😊 Great (8-10)', 'energy_great'),
            Markup.button.callback('😐 Okay (5-7)', 'energy_okay')
        ],
        [
            Markup.button.callback('😔 Low (1-4)', 'energy_low'),
            Markup.button.callback('💬 Type instead', 'energy_type')
        ]
    ]);

    await ctx.reply('How\'s your energy level today? ⚡', keyboard);
});

// Callback handlers for check-in
bot.action('energy_great', async (ctx) => {
    await ctx.answerCbQuery();
    await handleEnergyResponse(ctx, 9);
});

bot.action('energy_okay', async (ctx) => {
    await ctx.answerCbQuery();
    await handleEnergyResponse(ctx, 6);
});

bot.action('energy_low', async (ctx) => {
    await ctx.answerCbQuery();
    await handleEnergyResponse(ctx, 3);
});

bot.action('energy_type', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Great! Just type how you\'re feeling (1-10 or describe it) 😊');
});

async function handleEnergyResponse(ctx, energyLevel) {
    const user = ctx.state.user;

    const logData = {
        energy_level: energyLevel,
        mood_score: energyLevel, // Same for quick check-in
        urges_intensity: 5,
        stress_level: 5,
        focus_quality: 5,
        raw_message: `Quick check-in: ${energyLevel}/10`,
        sentiment_positive: energyLevel / 10,
        sentiment_negative: (10 - energyLevel) / 10,
        sentiment_compound: (energyLevel - 5) / 5,
        exercised: false,
        meditated: false,
        cold_shower: false,
        triggers_mentioned: [],
        accomplishments: null
    };

    await db.saveDailyLog(user.user_id, logData);

    const response = await aiAgent.generateAIResponse(
        user.user_id,
        `Energy check-in: ${energyLevel}/10`,
        'check_in'
    );

    await ctx.replyWithMarkdown(response);
}

// Command: /stats
bot.command('stats', async (ctx) => {
    await handleStatsRequest(ctx);
});

async function handleStatsRequest(ctx) {
    const user = ctx.state.user;
    const stats = await db.getUserStats(user.user_id);

    // Visual bars
    const energyBar = '⚡'.repeat(Math.round(user.current_energy / 100)) + '░'.repeat(10 - Math.round(user.current_energy / 100));

    const statsMessage = `📊 *Your Progress Stats*

🔥 Current Streak: *${user.current_streak} days*
${energyBar} (${user.current_energy})

📈 *All-Time Stats:*
✅ Total Check-ins: ${stats?.total_check_ins || 0}
📊 Avg Energy: ${Math.round(stats?.avg_energy || 0)}/10
😊 Avg Mood: ${Math.round(stats?.avg_mood || 0)}/10
🏆 Major Wins: ${stats?.total_wins || 0}
🔄 Relapses: ${stats?.total_relapses || 0}

${user.current_streak >= 7 ? '🎉 Amazing progress! Keep it up!' : '💪 Every day counts! You\'re doing great!'}`;

    await ctx.replyWithMarkdown(statsMessage);
}

// Command: /streak
bot.command('streak', async (ctx) => {
    const user = ctx.state.user;
    await ctx.reply(`🔥 *${user.current_streak} Day Streak!* Keep going!`, { parse_mode: 'Markdown' });
});

// Command: /goals
bot.command('goals', async (ctx) => {
    await handleGoalsRequest(ctx);
});

async function handleGoalsRequest(ctx) {
    const user = ctx.state.user;
    const goals = await db.getUserGoals(user.user_id);

    if (goals.length === 0) {
        await ctx.reply(
            'You don\'t have any active goals yet! 🎯',
            Markup.inlineKeyboard([
                Markup.button.callback('➕ Add Goal', 'add_goal')
            ])
        );
        return;
    }

    let goalsMessage = '*Your Active Goals:* 🎯\n\n';
    goals.forEach((goal, index) => {
        goalsMessage += `${index + 1}. *${goal.title}*\n`;
        const targetDate = new Date(goal.target_date);
        goalsMessage += `   📅 Due: ${targetDate.toLocaleDateString()}\n\n`;
    });

    await ctx.replyWithMarkdown(goalsMessage);
}

bot.action('add_goal', async (ctx) => {
    ctx.session = ctx.session || {};
    ctx.session.awaitingGoal = true;
    await ctx.reply('Great! What\'s your goal? 🎯\n\nExample: "Exercise 3 times a week"');
    await ctx.answerCbQuery();
});


// Command: /relapse
bot.command('relapse', async (ctx) => {
    const user = ctx.state.user;

    // Log intent first
    await db.logEvent(user.user_id, 'relapse', -50, 'User reported relapse via command', []);
    await db.addEnergyTransaction(user.user_id, -50, 'relapse', 'Relapse penalty');
    await db.updateUserStreak(user.user_id, 0);

    const response = await aiAgent.generateAIResponse(user.user_id, 'I relapsed', 'emergency');
    await ctx.replyWithMarkdown(response);
});

// Command: /win
bot.command('win', async (ctx) => {
    const user = ctx.state.user;
    const args = ctx.message.text.split(' ').slice(1).join(' ');
    const description = args || 'Major win';

    await db.logEvent(user.user_id, 'major_win', 20, description, []);
    await db.addEnergyTransaction(user.user_id, 20, 'achievement', 'Win bonus');

    const response = await aiAgent.generateAIResponse(user.user_id, `I achieved: ${description}`, 'celebration');
    await ctx.replyWithMarkdown(response);
});

// Command: /preferences
bot.command('preferences', async (ctx) => {
    const keyboard = Markup.inlineKeyboard([
        [
            Markup.button.callback('📱 Prefer Telegram', 'pref_telegram'),
            Markup.button.callback('💬 Prefer WhatsApp', 'pref_whatsapp')
        ]
    ]);
    await ctx.reply(`Your current preference is: *${ctx.state.user.preferred_channel || 'whatsapp'}*.\nWhere should I send scheduled reminders?`, { parse_mode: 'Markdown', ...keyboard });
});

bot.action('pref_telegram', async (ctx) => {
    await db.updateUserPreference(ctx.state.user.user_id, 'telegram');
    await ctx.answerCbQuery('Updated!');
    await ctx.editMessageText('✅ Preference updated: You will receive reminders on **Telegram**.', { parse_mode: 'Markdown' });
});

// --- Coach Mode Callbacks ---
bot.action(/mode_(.+)/, async (ctx) => {
    const mode = ctx.match[1];
    const user = ctx.state.user;

    // Update preference in DB
    const prefs = user.preferences || {};
    prefs.coach_persona = mode;

    await db.query('UPDATE users SET preferences = $1 WHERE user_id = $2', [JSON.stringify(prefs), user.user_id]);

    await ctx.answerCbQuery(`Coach mode set to ${mode}!`);
    await ctx.editMessageText(`✅ Coach Persona updated to: *${mode.toUpperCase()}*`, { parse_mode: 'Markdown' });
});

// --- SOS Callbacks ---
bot.action('sos_relapse_risk', async (ctx) => {
    await ctx.answerCbQuery();
    await handleSOS(ctx, 'I am about to relapse', 'emergency');
});

bot.action('sos_high_urges', async (ctx) => {
    await ctx.answerCbQuery();
    await handleSOS(ctx, 'My urges are extremely high', 'emergency');
});

bot.action('sos_emotional', async (ctx) => {
    await ctx.answerCbQuery();
    await handleSOS(ctx, 'I am feeling depressed and lonely', 'emergency');
});

bot.action('sos_panic', async (ctx) => {
    await ctx.answerCbQuery();
    await handleSOS(ctx, 'PANIC BUTTON PRESSED', 'emergency');
});

bot.action('menu_main', async (ctx) => {
    await ctx.deleteMessage();
    // Optional: Send main menu again if needed, or just clear the inline menu
});

async function handleSOS(ctx, userMessage, type) {
    const user = ctx.state.user;
    // Log intent
    await db.logEvent(user.user_id, 'sos_trigger', -5, userMessage, ['SOS']);

    const response = await aiAgent.generateAIResponse(user.user_id, userMessage, type);
    await ctx.replyWithMarkdown(response);
}

// Advanced: Polls
bot.command('moodpoll', async (ctx) => {
    await ctx.replyWithPoll(
        'How are you feeling today?',
        ['😊 Great', '😐 Okay', '😔 Not great', '😣 Struggling'],
        { is_anonymous: false }
    );
});

bot.on('poll_answer', async (ctx) => {
    // Process poll answer (simplified)
    const user = await db.getUserByTelegramId(ctx.pollAnswer.user.id);
    if (user) {
        // Could save log here
        console.log(`Poll Answer from ${user.name}: ${ctx.pollAnswer.option_ids}`);
    }
});

// Advanced: Inline Queries
bot.on('inline_query', async (ctx) => {
    const user = await db.getUserByTelegramId(ctx.from.id);
    const currentStreak = user?.current_streak || 0;

    const results = [
        {
            type: 'article',
            id: 'streak',
            title: 'My Current Streak',
            description: `${currentStreak} days 🔥`,
            input_message_content: {
                message_text: `🔥 My current streak: *${currentStreak} days*!`,
                parse_mode: 'Markdown'
            }
        }
    ];
    await ctx.answerInlineQuery(results);
});

// Advanced: Photos
bot.on('photo', async (ctx) => {
    await ctx.reply('Great progress photo! 📸 Added to your journey.');
});


// Handle text messages
bot.on('text', async (ctx) => {
    if (ctx.message.text.startsWith('/')) return;

    const user = ctx.state.user;
    const messageText = ctx.message.text;

    // Check if waiting for goal (Session)
    if (ctx.session?.awaitingGoal) {
        // Create goal
        await db.query(
            `INSERT INTO goals (user_id, title, target_date) VALUES ($1, $2, CURRENT_DATE + INTERVAL '30 days')`,
            [user.user_id, messageText]
        );
        ctx.session.awaitingGoal = false;
        await ctx.reply('Goal saved! 🎯');
        return;
    }

    // Save conversation
    await db.saveConversation(user.user_id, 'user', messageText, 'casual', null, ctx.message.message_id, 'telegram');

    // NLP
    const analysis = nlp.analyzeMessage(messageText);
    await db.saveDailyLog(user.user_id, analysis);

    // Intent Detection
    const isRelapse = await aiAgent.detectRelapseIntent(messageText);
    const isWin = await aiAgent.detectWinIntent(messageText);

    let messageType = 'casual';
    if (isRelapse) {
        messageType = 'emergency';
        await db.logEvent(user.user_id, 'relapse', -50, messageText, analysis.triggers_mentioned);
        await db.addEnergyTransaction(user.user_id, -50, 'relapse', 'Relapse penalty');
        await db.updateUserStreak(user.user_id, 0);
    } else if (isWin) {
        messageType = 'celebration';
        await db.logEvent(user.user_id, 'major_win', 20, messageText, []);
        await db.addEnergyTransaction(user.user_id, 20, 'achievement', 'Win bonus');
    } else if (messageText.toLowerCase().includes('stats')) {
        messageType = 'stats_request'; // Support the new prompt type
    }

    // AI Response
    const aiResponse = await aiAgent.generateAIResponse(user.user_id, messageText, messageType);

    // Save bot response
    await db.saveConversation(user.user_id, 'agent', aiResponse, messageType, null, null, 'telegram');

    await ctx.reply(aiResponse);
});

// Error handling
bot.catch((err, ctx) => {
    console.error('Bot error', err);
});

module.exports = bot;
