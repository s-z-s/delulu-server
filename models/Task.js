const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
    firebaseUid: {
        type: String,
        required: true
    },
    sectorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Sector',
        required: true
    },
    text: {
        type: String,
        required: true
    },
    isCompleted: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    completedAt: {
        type: Date
    },
    reminderTime: {
        type: Date
    },
    hasReminder: {
        type: Boolean,
        default: false
    }
});

module.exports = mongoose.model('Task', TaskSchema);
