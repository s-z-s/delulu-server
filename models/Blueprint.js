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
        description: { type: String }, // New field
        duration: { type: Number, default: 15 },
        isCompleted: { type: Boolean, default: false }
    }],
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Blueprint', BlueprintSchema);
