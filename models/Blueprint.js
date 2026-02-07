const mongoose = require('mongoose');

const BlueprintSchema = new mongoose.Schema({
    firebaseUid: {
        type: String,
        required: true,
        index: true // Keep index for performance, but remove unique
    },
    dream: {
        type: String,
        required: true
    },
    quests: [{
        title: { type: String, required: true },
        description: { type: String },
        checklist: [{ type: String }],
        duration: { type: Number, default: 15 },
        isCompleted: { type: Boolean, default: false },
        evidenceUrl: { type: String },
        type: { type: String, default: 'quest' } // 'quest' or 'reward'
    }],
    visionBoard: [{
        id: { type: String },
        type: { type: String, enum: ['image', 'text'], default: 'image' },
        content: { type: String }, // URL or Text
        createdAt: { type: Date, default: Date.now }
    }],
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Blueprint', BlueprintSchema);
