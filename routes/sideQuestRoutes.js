const express = require('express');
const router = express.Router();
const SideQuest = require('../models/SideQuest');
const User = require('../models/User'); // Need User to update stats
const { protect } = require('../middleware/authMiddleware');

// @desc    Get user side quests
// @route   GET /api/side-quests
router.get('/', protect, async (req, res) => {
    try {
        const quests = await SideQuest.find({ firebaseUid: req.user.uid }).sort({ createdAt: 1 });
        res.json(quests);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Create a new side quest
// @route   POST /api/side-quests
router.post('/', protect, async (req, res) => {
    const { title } = req.body;
    if (!title) return res.status(400).json({ message: 'Title is required' });

    try {
        const quest = await SideQuest.create({
            firebaseUid: req.user.uid,
            title
        });

        // Update User Stats: sideQuestsCreated
        await User.findOneAndUpdate(
            { firebaseUid: req.user.uid },
            { $inc: { 'stats.sideQuestsCreated': 1 } }
        );

        res.status(201).json(quest);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Toggle completion for a specific date ('YYYY-MM-DD')
// @route   POST /api/side-quests/:id/toggle-date
router.post('/:id/toggle-date', protect, async (req, res) => {
    const { date } = req.body;
    if (!date) return res.status(400).json({ message: 'date is required (YYYY-MM-DD)' });

    try {
        const quest = await SideQuest.findOne({ _id: req.params.id, firebaseUid: req.user.uid });
        if (!quest) return res.status(404).json({ message: 'Quest not found' });

        if (!Array.isArray(quest.completedDates)) {
            quest.completedDates = [];
        }

        const dateIndex = quest.completedDates.indexOf(date);
        const isAdding = dateIndex === -1;

        if (isAdding) {
            quest.completedDates.push(date);
            quest.completedDates.sort();
            quest.lastLoggedAt = new Date();
        } else {
            quest.completedDates.splice(dateIndex, 1);
        }

        quest.logs = quest.completedDates.length;
        await quest.save();

        // Update User Stats: maxLogsInOneQuest
        if (quest.logs > 0) {
            const user = await User.findOne({ firebaseUid: req.user.uid });
            if (user && quest.logs > (user.stats?.maxLogsInOneQuest || 0)) {
                user.stats.maxLogsInOneQuest = quest.logs;
                await user.save();
            }
        }

        res.json(quest);
    } catch (error) {
        console.error('[SideQuest] Error toggling date:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Log a check-in (increase bubble size)
// @route   POST /api/side-quests/:id/log
router.post('/:id/log', protect, async (req, res) => {
    const delta = (req.body.delta !== undefined) ? parseInt(req.body.delta) : 1;
    const today = new Date().toISOString().split('T')[0];

    try {
        const quest = await SideQuest.findOne({ _id: req.params.id, firebaseUid: req.user.uid });
        if (!quest) return res.status(404).json({ message: 'Quest not found' });

        if (!Array.isArray(quest.completedDates)) {
            quest.completedDates = [];
        }

        if (delta > 0) {
            if (!quest.completedDates.includes(today)) {
                quest.completedDates.push(today);
                quest.completedDates.sort();
            }
        } else if (delta < 0) {
            const todayIndex = quest.completedDates.indexOf(today);
            if (todayIndex !== -1) {
                quest.completedDates.splice(todayIndex, 1);
            }
        }

        quest.logs = Math.max(quest.completedDates.length, quest.logs + delta);
        quest.lastLoggedAt = new Date();
        await quest.save();

        // Update User Stats: maxLogsInOneQuest
        if (quest.logs > 0) {
            const user = await User.findOne({ firebaseUid: req.user.uid });
            if (user && quest.logs > (user.stats?.maxLogsInOneQuest || 0)) {
                user.stats.maxLogsInOneQuest = quest.logs;
                await user.save();
            }
        }

        res.json(quest);
    } catch (error) {
        console.error('[SideQuest] Error logging check-in:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Update side quest title
// @route   PUT /api/side-quests/:id
router.put('/:id', protect, async (req, res) => {
    const { title } = req.body;
    try {
        const quest = await SideQuest.findOneAndUpdate(
            { _id: req.params.id, firebaseUid: req.user.uid },
            { title },
            { new: true }
        );
        if (!quest) return res.status(404).json({ message: 'Quest not found' });
        res.json(quest);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Delete a side quest
// @route   DELETE /api/side-quests/:id
router.delete('/:id', protect, async (req, res) => {
    try {
        await SideQuest.findOneAndDelete({ _id: req.params.id, firebaseUid: req.user.uid });
        res.json({ message: 'Removed' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

module.exports = router;
