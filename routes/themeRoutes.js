const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');

// Update Theme Preference
router.post('/', protect, async (req, res) => {
    try {
        const { themeId, themeMode } = req.body;
        const uid = req.user.uid;

        const updateData = {};
        if (themeId) updateData['config.themeId'] = themeId;
        if (themeMode) updateData['config.themeMode'] = themeMode;

        const user = await User.findOneAndUpdate(
            { firebaseUid: uid },
            { $set: updateData },
            { new: true }
        );

        if (!user) return res.status(404).json({ message: 'User not found' });

        res.json(user.config);
    } catch (error) {
        console.error('Error updating theme:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
