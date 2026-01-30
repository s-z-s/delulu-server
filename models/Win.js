const mongoose = require('mongoose');

const WinSchema = new mongoose.Schema({
    firebaseUid: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['mini', 'major'],
        default: 'mini'
    },
    hypeComment: {
        type: String,
        default: ''
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Win', WinSchema);
