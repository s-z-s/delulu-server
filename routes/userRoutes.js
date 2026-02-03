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
        const updates = {}; // FIX: Initialize variable

        if (questsCompleted !== undefined) updates['stats.questsCompleted'] = questsCompleted;
        if (req.body.sideQuestsCompleted !== undefined) updates['stats.sideQuestsCompleted'] = req.body.sideQuestsCompleted; // New Field
        if (currentStreak !== undefined) updates['stats.currentStreak'] = currentStreak;
        updates['stats.lastLoginDate'] = new Date();

        console.log(`[SYNC] Updating stats for ${tokenUid}:`, updates);

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

// @desc    Get user data (including achievements/stats)
// @route   GET /api/user
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const { uid: tokenUid } = req.user;
        const user = await User.findOne({ firebaseUid: tokenUid });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Record daily login (Heartbeat)
// @route   POST /api/user/heartbeat
// @access  Private
router.post('/heartbeat', protect, async (req, res) => {
    try {
        const { uid: tokenUid } = req.user;
        const user = await User.findOne({ firebaseUid: tokenUid });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalize to start of day

        // Check if today is already logged
        const lastLogin = user.stats.lastLoginDate ? new Date(user.stats.lastLoginDate) : null;
        let isNewDay = true;

        if (lastLogin) {
            const lastLoginNormalized = new Date(lastLogin);
            lastLoginNormalized.setHours(0, 0, 0, 0);
            if (lastLoginNormalized.getTime() === today.getTime()) {
                isNewDay = false;
            }
        }

        if (isNewDay) {
            user.stats.lastLoginDate = new Date();
            user.stats.totalDaysLogged += 1;
            user.stats.loginHistory.push(new Date());

            // Simple Streak Logic (Consecutive Days)
            // If last login was yesterday, increment. Else reset to 1.
            // (Skipping detailed streak recalc here, relying on simple check for now or if user missed a day)
            // For complex streaks, we use the history array client-side or calc here.
            // Let's keep server logic simple: Record the date.

            // Cap history to 365 days to save space
            if (user.stats.loginHistory.length > 365) {
                user.stats.loginHistory.shift(); // Remove oldest
            }

            await user.save();
        }

        res.status(200).json(user);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});


// @desc    Start user quest (Persistence)
// @route   POST /api/user/quest/start
// @access  Private
router.post('/quest/start', protect, async (req, res) => {
    try {
        const { title } = req.body;
        const { uid: tokenUid } = req.user;

        const user = await User.findOne({ firebaseUid: tokenUid });
        if (!user) return res.status(404).json({ message: 'User not found' });

        user.currentQuest = {
            title,
            status: 'in_progress',
            startedAt: new Date(),
            completedChecklistIndices: []
        };

        await user.save();
        res.status(200).json(user.currentQuest);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Update quest checklist progress
// @route   PUT /api/user/quest/progress
// @access  Private
router.put('/quest/progress', protect, async (req, res) => {
    try {
        const { indices } = req.body; // Array of completed indices
        const { uid: tokenUid } = req.user;

        const user = await User.findOne({ firebaseUid: tokenUid });
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (user.currentQuest && user.currentQuest.status === 'in_progress') {
            user.currentQuest.completedChecklistIndices = indices;
            await user.save();
        }

        res.status(200).json(user.currentQuest);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Cancel/Clear current quest
// @route   POST /api/user/quest/cancel
// @access  Private
router.post('/quest/cancel', protect, async (req, res) => {
    try {
        const { uid: tokenUid } = req.user;
        const user = await User.findOne({ firebaseUid: tokenUid });

        if (user) {
            user.currentQuest = {
                title: null,
                status: 'idle',
                startedAt: null,
                completedChecklistIndices: []
            };
            await user.save();
        }

        res.status(200).json({ message: 'Quest cancelled' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

module.exports = router;
