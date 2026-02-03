const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const User = require('../models/User');

// @desc    Sync user data from Firebase to MongoDB
// @route   POST /api/auth/sync
// @access  Private (Bearer token required)

const Sector = require('../models/Sector');

// Helper to create default sectors
async function createDefaultSectors(uid) {
    const existingCount = await Sector.countDocuments({ firebaseUid: uid });
    if (existingCount === 0) {
        const defaults = [
            { title: 'Body', color: '0xFFFF7043' },     // Vibrant Orange
            { title: 'Soul', color: '0xFF9575CD' },     // Deep Purple
            { title: 'Friends', color: '0xFF26C6DA' },  // Cyan
            { title: 'Romance', color: '0xFFE57373' },  // Soft Red
            { title: 'Family', color: '0xFF4FC3F7' },   // Light Blue
            { title: 'Mind', color: '0xFF81C784' },     // Green
            { title: 'Money', color: '0xFFFFD54F' },    // Amber
            { title: 'Growth', color: '0xFFF06292' }    // Pink
        ];

        await Sector.insertMany(defaults.map(s => ({ ...s, firebaseUid: uid })));
    }
}

// Attach to sync logic
router.post('/sync', protect, async (req, res) => {
    try {
        // Extract fields from body (Client sends source of truth for first sync)
        const { email, name, age, onboardingProgress } = req.body;
        const { uid: tokenUid } = req.user;

        // Use body email/name if provided, fallback to token (which might be empty for anon)
        const userEmail = email || req.user.email;
        const userName = name || req.user.name || (userEmail ? userEmail.split('@')[0] : 'Delulu Dreamer');

        // findOneAndUpdate with upsert option
        const user = await User.findOneAndUpdate(
            { firebaseUid: tokenUid },
            {
                firebaseUid: tokenUid,
                email: userEmail,
                displayName: userName,
                age: age,
                onboardingProgress: onboardingProgress
            },
            { new: true, upsert: true }
        );

        // Ensure default sectors exist
        await createDefaultSectors(tokenUid);

        res.status(200).json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error during sync' });
    }
});

module.exports = router;
