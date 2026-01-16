const { Markup } = require('telegraf');

const MainMenu = Markup.keyboard([
    ['⚡ Check-in', '📊 Stats'],
    ['🆘 SOS', '🎯 Goals'],
    ['⚙️ Settings', '🧘 Coach Mode']
]).resize();

const CheckInMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback('😊 Great (8-10)', 'energy_great'),
        Markup.button.callback('😐 Okay (5-7)', 'energy_okay')
    ],
    [
        Markup.button.callback('😔 Low (1-4)', 'energy_low'),
        Markup.button.callback('😣 Struggling', 'energy_struggle')
    ],
    [
        Markup.button.callback('🔙 Back', 'menu_main')
    ]
]);

const SOSMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback('⚠️ I might relapse', 'sos_relapse_risk'),
        Markup.button.callback('🔥 Urges are high', 'sos_high_urges')
    ],
    [
        Markup.button.callback('😞 Feeling down/lonely', 'sos_emotional'),
        Markup.button.callback('🛑 Panic Button', 'sos_panic')
    ],
    [
        Markup.button.callback('🔙 False Alarm', 'menu_main')
    ]
]);

const CoachModeMenu = Markup.inlineKeyboard([
    [
        Markup.button.callback('🧘 Stoic Mentor', 'mode_stoic'),
        Markup.button.callback('🔥 Drill Sergeant', 'mode_drill')
    ],
    [
        Markup.button.callback('🤝 Empathetic Friend', 'mode_friend'),
        Markup.button.callback('🧠 Data Analyst', 'mode_analyst')
    ],
    [
        Markup.button.callback('🔙 Back', 'menu_main')
    ]
]);

module.exports = {
    MainMenu,
    CheckInMenu,
    SOSMenu,
    CoachModeMenu
};
