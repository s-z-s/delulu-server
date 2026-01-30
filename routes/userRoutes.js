const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const User = require('../models/User');

// @desc    Add unlocked achievement
// @route   POST /api/user/achievement
// @access  Private
router.post('/achievement', protect, async (req, res) => {
    try {
        const { achievementId } = req.body;
        const { uid: tokenUid } = req.user;

        if (!achievementId) {
            return res.status(400).json({ message: 'Achievement ID required' });
        }

        // Find user
        const user = await User.findOne({ firebaseUid: tokenUid });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Check if already unlocked
        const alreadyExists = user.achievements.some(a => a.id === achievementId);

        if (alreadyExists) {
            return res.status(200).json(user); // Idempotent success
        }

        // Add achievement
        user.achievements.push({
            id: achievementId,
            unlockedAt: new Date(),
            isClaimed: false
        });

        await user.save();
        res.status(200).json(user);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Update user stats (quests, streaks)
// @route   PUT /api/user/stats
// @access  Private
router.put('/stats', protect, async (req, res) => {
    try {
        const { questsCompleted, currentStreak } = req.body;
        const { uid: tokenUid } = req.user;

        const updates = {};
        if (questsCompleted !== undefined) updates['stats.questsCompleted'] = questsCompleted;
        if (currentStreak !== undefined) updates['stats.currentStreak'] = currentStreak;
        updates['stats.lastLoginDate'] = new Date();

        const user = await User.findOneAndUpdate(
            { firebaseUid: tokenUid },
            { $set: updates },
            { new: true, upsert: true } // Upsert ensures doc exists
        );

        res.status(200).json(user);

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

module.exports = router;
