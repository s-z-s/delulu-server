const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const User = require('../models/User');
const axios = require('axios');

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

        // --- STREAK CALCULATION ON FETCH ---
        const today = new Date();
        today.setHours(0, 0, 0, 0);

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

            if (lastLogin) {
                const lastLoginNormalized = new Date(lastLogin);
                lastLoginNormalized.setHours(0, 0, 0, 0);

                // Calculate difference in days
                const diffTime = Math.abs(today.getTime() - lastLoginNormalized.getTime());
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                // User Rule: Streak lasts at least 3 days. 
                // GAP <= 3 days -> Maintain Streak.
                if (diffDays <= 3) {
                    if (!user.stats.currentStreak) user.stats.currentStreak = 0;
                    user.stats.currentStreak += 1;
                } else {
                    user.stats.currentStreak = 1;
                }
            } else {
                user.stats.currentStreak = 1;
            }

            if (user.stats.loginHistory.length > 365) {
                user.stats.loginHistory.shift();
            }
            await user.save();
        } else {
            // Repair 0 streak if logged in today
            if (!user.stats.currentStreak || user.stats.currentStreak <= 0) {
                user.stats.currentStreak = 1;
                await user.save();
            }
        }
        // ------------------------------------
        // --- EXPLORER STATUS (RevenueCat) ---
        let isExplorer = false;
        try {
            const rcResponse = await axios.get(
                `https://api.revenuecat.com/v1/subscribers/${tokenUid}`,
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.REVENUECAT_SECRET_KEY}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const entitlements = rcResponse.data.subscriber.entitlements;
            isExplorer = entitlements && entitlements.explorer_access && entitlements.explorer_access.expires_date
                ? new Date(entitlements.explorer_access.expires_date) > new Date()
                : !!(entitlements && entitlements.explorer_access);

            console.log(`[RC] Explorer status for ${tokenUid}: ${isExplorer}`);
        } catch (rcError) {
            console.error('[RC] Error fetching subscriber info:', rcError.message);
            // Default to false on error to avoid blocking user data
        }
        // ------------------------------------

        res.status(200).json({
            ...user.toObject(),
            isExplorer
        });
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

        // Legacy: Logic moved to generic GET /api/user (fetchUserData)
        // This endpoint is kept to avoid 404s until client update.
        // It does NOT update streaks anymore.

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

// @desc    Mark a feature guide as seen
// @route   PUT /api/user/config/guides
// @access  Private
router.put('/config/guides', protect, async (req, res) => {
    try {
        const { guideId } = req.body;
        const { uid: tokenUid } = req.user;

        if (!guideId) {
            return res.status(400).json({ message: 'Guide ID required' });
        }

        const user = await User.findOne({ firebaseUid: tokenUid });
        if (!user) return res.status(404).json({ message: 'User not found' });

        if (!user.config.guidesSeen.includes(guideId)) {
            user.config.guidesSeen.push(guideId);
            await user.save();
        }

        res.status(200).json({ guidesSeen: user.config.guidesSeen });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

module.exports = router;
