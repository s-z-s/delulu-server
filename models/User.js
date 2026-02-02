const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    firebaseUid: {
        type: String,
        required: true,
        unique: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    displayName: {
        type: String,
    },
    delusionalDream: {
        type: String,
    },
    age: {
        type: Number,
    },
    onboardingProgress: {
        type: String, // e.g., "Just an idea", "Fully committed"
    },
    achievements: [{
        id: { type: String, required: true },
        unlockedAt: { type: Date, default: Date.now },
        isClaimed: { type: Boolean, default: false } // For "claiming" rewards like coffee
    }],
    stats: {
        questsCompleted: { type: Number, default: 0 },
        sideQuestsCompleted: { type: Number, default: 0 },
        currentStreak: { type: Number, default: 0 },
        lastLoginDate: { type: Date },
        totalDaysLogged: { type: Number, default: 0 },
        loginHistory: [{ type: Date }], // New: Track specific dates for complex streaks
        // New Habit Stats
        sideQuestsCreated: { type: Number, default: 0 },
        maxLogsInOneQuest: { type: Number, default: 0 },

        // ToDo Stats
        tasksCreated: { type: Number, default: 0 },
        tasksCompleted: { type: Number, default: 0 }
    }
}, {
    timestamps: true,
});

module.exports = mongoose.model('User', UserSchema);
