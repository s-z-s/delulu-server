const mongoose = require('mongoose');

const SectorSchema = new mongoose.Schema({
    firebaseUid: {
        type: String,
        required: true
    },
    title: {
        type: String,
        required: true
    },
    color: {
        type: String, // Hex string or preset name
        default: '0xFFFFFFFF'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Sector', SectorSchema);
