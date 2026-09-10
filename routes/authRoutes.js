const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const User = require('../models/User');

// @desc    Sync user data from Firebase to MongoDB
// @route   POST /api/auth/sync
// @access  Private (Bearer token required)

const Sector = require('../models/Sector');
const axios = require('axios');

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
            { title: 'Career', color: '0xFFF06292' }    // Pink
        ];

        await Sector.insertMany(defaults.map(s => ({ ...s, firebaseUid: uid })));
    }
}

// Helper to grant 30-day Explorer trial via RevenueCat
async function grantExplorerTrial(userId) {
    // Check if free trial is enabled via env
    const enableTrial = process.env.ENABLE_FREE_TRIAL?.toLowerCase();
    if (enableTrial === 'false' || enableTrial === '0') {
        console.log('[RevenueCat] Free trial disabled via ENABLE_FREE_TRIAL env');
        return;
    }

    const secretKey = process.env.REVENUECAT_SECRET_KEY;
    if (!secretKey) {
        console.log('[RevenueCat] REVENUECAT_SECRET_KEY not configured, skipping trial grant');
        return;
    }

    try {
        const endTime = new Date();
        endTime.setDate(endTime.getDate() + 30); // 30 days from now

        await axios.post(
            `https://api.revenuecat.com/v1/subscribers/${userId}/entitlements/explorer_access/promotional`,
            {
                duration: 'P30D' // ISO 8601 duration: 30 days
            },
            {
                headers: {
                    'Authorization': `Bearer ${secretKey}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log(`[RevenueCat] Granted 30-day Explorer trial to ${userId}`);
    } catch (error) {
        console.error('[RevenueCat] Trial grant error:', error.response?.data || error.message);
    }
}

// Attach to sync logic
router.post('/sync', protect, async (req, res) => {
    try {
        // Extract fields from body (Client sends source of truth for first sync)
        const { email, name, age, onboardingProgress, photoURL } = req.body;
        const { uid: tokenUid } = req.user;

        // Use body email/name if provided, fallback to token (which might be empty for anon)
        const rawEmail = email || req.user.email;
        const userEmail = (rawEmail && typeof rawEmail === 'string' && rawEmail.trim() !== '')
            ? rawEmail.trim().toLowerCase()
            : null;
        const userName = name || req.user.name || (userEmail ? userEmail.split('@')[0] : 'Delulu Dreamer');

        // Check 1: Find existing user by firebaseUid
        let user = await User.findOne({ firebaseUid: tokenUid });
        let isNewUser = false;

        // Check 2: If not found by firebaseUid, but userEmail exists, check if user exists by email
        // (Handles re-install, device change, or account linking with existing email)
        if (!user && userEmail) {
            user = await User.findOne({ email: userEmail });
            if (user) {
                console.log(`[AUTH] Linking existing account for ${userEmail} to new firebaseUid: ${tokenUid}`);
                user.firebaseUid = tokenUid;
            }
        }

        const userPhotoURL = photoURL || (user ? user.photoURL : req.user.picture);

        if (!user) {
            isNewUser = true;
            user = new User({
                firebaseUid: tokenUid,
                ...(userEmail ? { email: userEmail } : {}),
                displayName: userName,
                photoURL: userPhotoURL,
                age: age,
                onboardingProgress: onboardingProgress
            });
        } else {
            // Update existing user fields
            if (userEmail) user.email = userEmail;
            if (userName) user.displayName = userName;
            if (userPhotoURL) user.photoURL = userPhotoURL;
            if (age !== undefined && age !== null) user.age = age;
            if (onboardingProgress !== undefined && onboardingProgress !== null) {
                user.onboardingProgress = onboardingProgress;
            }
        }

        await user.save();

        // Ensure default sectors exist
        await createDefaultSectors(tokenUid);

        // Grant 30-day Explorer trial for new users
        if (isNewUser) {
            grantExplorerTrial(tokenUid).catch(console.error);
        }

        res.status(200).json(user);
    } catch (error) {
        console.error('[AUTH SYNC ERROR]', error);
        res.status(500).json({ message: 'Server Error during sync', error: error.message });
    }
});

module.exports = router;
