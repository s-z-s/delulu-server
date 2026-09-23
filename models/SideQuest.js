const mongoose = require('mongoose');

const SideQuestSchema = new mongoose.Schema({
    firebaseUid: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    logs: {
        type: Number,
        default: 0
    },
    lastLoggedAt: {
        type: Date,
        default: null
    },
    completedDates: {
        type: [String], // Array of 'YYYY-MM-DD'
        default: []
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('SideQuest', SideQuestSchema);
