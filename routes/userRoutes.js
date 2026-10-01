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
            { 
                $set: updates,
                $setOnInsert: {
                    firebaseUid: tokenUid,
                    displayName: req.user?.name || 'Delulu Dreamer',
                    photoURL: req.user?.picture || null
                }
            },
            { new: true, upsert: true, setDefaultsOnInsert: true }
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
        // --- EXPLORER STATUS (RevenueCat + DB fallback) ---
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

            const entitlements = rcResponse.data?.subscriber?.entitlements;
            isExplorer = entitlements && entitlements.explorer_access && entitlements.explorer_access.expires_date
                ? new Date(entitlements.explorer_access.expires_date) > new Date()
                : !!(entitlements && entitlements.explorer_access);

            console.log(`[RC] Explorer status for ${tokenUid}: ${isExplorer}`);
        } catch (rcError) {
            console.error('[RC] Error fetching subscriber info:', rcError.message);
            // Default to false on error to avoid blocking user data
        }

        // DB Explorer check (e.g. from redeemed coupon)
        if (!isExplorer && user.explorerExpiresAt && new Date(user.explorerExpiresAt) > new Date()) {
            isExplorer = true;
            console.log(`[DB] Explorer status for ${tokenUid} active via explorerExpiresAt: ${user.explorerExpiresAt}`);
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

// Valid coupons registry
const VALID_COUPONS = {
    'SHIPATON2026': {
        duration: 'monthly',
        durationDays: 30,
        description: '1 month of Explorer access'
    }
};

// @desc    Redeem coupon code for Explorer access
// @route   POST /api/user/redeem-coupon
// @access  Private
router.post('/redeem-coupon', protect, async (req, res) => {
    try {
        const { code } = req.body;
        const { uid: tokenUid } = req.user;

        if (!code || typeof code !== 'string') {
            return res.status(400).json({ message: 'Please enter a coupon code.' });
        }

        const normalizedCode = code.trim().toUpperCase();

        const couponConfig = VALID_COUPONS[normalizedCode];
        if (!couponConfig) {
            return res.status(400).json({ message: 'Invalid coupon code. Please check and try again.' });
        }

        // Find user
        let user = await User.findOne({ firebaseUid: tokenUid });
        if (!user) {
            user = new User({
                firebaseUid: tokenUid,
                displayName: req.user?.name || 'Delulu Dreamer',
                photoURL: req.user?.picture || null
            });
        }

        // Check if user already redeemed this code
        const alreadyRedeemed = user.redeemedCoupons && user.redeemedCoupons.some(c => c.code === normalizedCode);
        if (alreadyRedeemed) {
            return res.status(400).json({ 
                message: `Coupon "${normalizedCode}" has already been redeemed on this account.` 
            });
        }

        // Calculate expiration date (1 month / 30 days)
        const now = new Date();
        const baseDate = (user.explorerExpiresAt && new Date(user.explorerExpiresAt) > now)
            ? new Date(user.explorerExpiresAt)
            : now;
        const expiresAt = new Date(baseDate.getTime() + couponConfig.durationDays * 24 * 60 * 60 * 1000);

        // Grant promotional entitlement in RevenueCat
        let rcGranted = false;
        const secretKey = process.env.REVENUECAT_SECRET_KEY;
        if (secretKey) {
            try {
                await axios.post(
                    `https://api.revenuecat.com/v1/subscribers/${tokenUid}/entitlements/explorer_access/promotional`,
                    {
                        duration: couponConfig.duration
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${secretKey}`,
                            'Content-Type': 'application/json'
                        }
                    }
                );
                rcGranted = true;
                console.log(`[Coupon] Granted ${couponConfig.duration} Explorer access in RevenueCat to ${tokenUid}`);
            } catch (rcError) {
                console.error('[Coupon] RevenueCat promotional grant error:', rcError.response?.data || rcError.message);
            }
        }

        // Update User in DB
        user.explorerExpiresAt = expiresAt;
        if (!user.redeemedCoupons) user.redeemedCoupons = [];
        user.redeemedCoupons.push({
            code: normalizedCode,
            redeemedAt: now,
            duration: couponConfig.duration,
            expiresAt: expiresAt
        });

        await user.save();

        res.status(200).json({
            success: true,
            message: `Coupon ${normalizedCode} applied! You now have Explorer access for 1 month.`,
            code: normalizedCode,
            isExplorer: true,
            expiresAt: expiresAt.toISOString(),
            revenueCatSynced: rcGranted
        });

    } catch (error) {
        console.error('[Coupon] Error redeeming coupon:', error);
        res.status(500).json({ message: 'Server error while redeeming coupon. Please try again.' });
    }
});

module.exports = router;
