const mongoose = require('mongoose');

const MoodSchema = new mongoose.Schema({
    firebaseUid: {
        type: String,
        required: true,
        index: true
    },
    date: {
        type: String, // Format: 'YYYY-MM-DD'
        required: true,
        index: true
    },
    moodScore: {
        type: Number, // 1 (sad) to 5 (ecstatic)
        required: true,
        min: 1,
        max: 5
    },
    emoji: {
        type: String,
        required: true
    },
    remark: {
        type: String,
        default: '',
        trim: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Compound unique index: only 1 mood per day per user
MoodSchema.index({ firebaseUid: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Mood', MoodSchema);
