const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const User = require('../models/User');

// @desc    Sync user data from Firebase to MongoDB
// @route   POST /api/auth/sync
// @access  Private (Bearer token required)
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

        res.status(200).json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error during sync' });
    }
});

module.exports = router;
