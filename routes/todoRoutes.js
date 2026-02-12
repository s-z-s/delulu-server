const express = require('express');
const router = express.Router();
const Sector = require('../models/Sector');
const Task = require('../models/Task');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');
const { generateAIResponse } = require('../services/aiService');

// @desc    Get all sectors with task counts (with optional date filtering)
// @route   GET /api/todos/sectors?from=ISO_DATE&to=ISO_DATE
router.get('/sectors', protect, async (req, res) => {
    try {
        const { from, to } = req.query;

        // Build date filter for completed tasks
        let dateFilter = {};
        if (from || to) {
            dateFilter = {};
            if (from) dateFilter.$gte = new Date(from);
            if (to) dateFilter.$lte = new Date(to);
        }

        const sectors = await Sector.aggregate([
            { $match: { firebaseUid: req.user.uid } },
            {
                $lookup: {
                    from: 'tasks',
                    let: { sectorId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $eq: ['$sectorId', '$$sectorId']
                                }
                            }
                        },
                        {
                            $group: {
                                _id: null,
                                // Active tasks: always count all incomplete tasks
                                active: { $sum: { $cond: [{ $ne: ['$isCompleted', true] }, 1, 0] } },
                                // Completed tasks: filter by date if provided
                                completed: {
                                    $sum: {
                                        $cond: [
                                            {
                                                $and: [
                                                    { $eq: ['$isCompleted', true] },
                                                    // If date range specified, check completedAt
                                                    ...(from ? [{ $gte: ['$completedAt', new Date(from)] }] : []),
                                                    ...(to ? [{ $lte: ['$completedAt', new Date(to)] }] : [])
                                                ]
                                            },
                                            1,
                                            0
                                        ]
                                    }
                                }
                            }
                        }
                    ],
                    as: 'taskCounts'
                }
            },
            {
                $addFields: {
                    activeTaskCount: { $ifNull: [{ $arrayElemAt: ['$taskCounts.active', 0] }, 0] },
                    completedTaskCount: { $ifNull: [{ $arrayElemAt: ['$taskCounts.completed', 0] }, 0] }
                }
            },
            { $project: { taskCounts: 0 } },
            { $sort: { createdAt: 1 } }
        ]);
        res.json(sectors);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Create sector
// @route   POST /api/todos/sectors
router.post('/sectors', protect, async (req, res) => {
    try {
        const { title, color } = req.body;
        const sector = await Sector.create({
            firebaseUid: req.user.uid,
            title,
            color
        });
        res.status(201).json(sector);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Delete sector (and its tasks)
// @route   DELETE /api/todos/sectors/:id
router.delete('/sectors/:id', protect, async (req, res) => {
    try {
        await Sector.findOneAndDelete({ _id: req.params.id, firebaseUid: req.user.uid });
        await Task.deleteMany({ sectorId: req.params.id, firebaseUid: req.user.uid });
        res.json({ message: 'Sector deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// === TASKS ===

// @desc    Get tasks for a sector
// @route   GET /api/todos/sectors/:sectorId/tasks
router.get('/sectors/:sectorId/tasks', protect, async (req, res) => {
    try {
        const tasks = await Task.find({
            sectorId: req.params.sectorId,
            firebaseUid: req.user.uid
        }).sort({ isCompleted: 1, createdAt: -1 }); // Active first, then by date
        res.json(tasks);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Create task
// @route   POST /api/todos/tasks
router.post('/tasks', protect, async (req, res) => {
    try {
        const { sectorId, text } = req.body;
        const task = await Task.create({
            firebaseUid: req.user.uid,
            sectorId,
            text
        });

        // Update Stats: tasksCreated? (Optional, maybe for achievements)
        await User.findOneAndUpdate(
            { firebaseUid: req.user.uid },
            { $inc: { 'stats.tasksCreated': 1 } }
        );

        res.status(201).json(task);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Toggle task completion
// @route   PUT /api/todos/tasks/:id/toggle
router.put('/tasks/:id/toggle', protect, async (req, res) => {
    try {
        const task = await Task.findOne({ _id: req.params.id, firebaseUid: req.user.uid });
        if (!task) return res.status(404).json({ message: 'Task not found' });

        task.isCompleted = !task.isCompleted;
        task.completedAt = task.isCompleted ? new Date() : null;
        await task.save();

        if (task.isCompleted) {
            await User.findOneAndUpdate(
                { firebaseUid: req.user.uid },
                { $inc: { 'stats.tasksCompleted': 1 } }
            );
        }

        res.json(task);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Delete task
// @route   DELETE /api/todos/tasks/:id
router.delete('/tasks/:id', protect, async (req, res) => {
    try {
        await Task.findOneAndDelete({ _id: req.params.id, firebaseUid: req.user.uid });
        res.json({ message: 'Task deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
});
// @desc    Set task reminder
// @route   PUT /api/todos/tasks/:id/reminder
router.put('/tasks/:id/reminder', protect, async (req, res) => {
    try {
        const { reminderTime } = req.body; // ISO String or null
        const task = await Task.findOne({ _id: req.params.id, firebaseUid: req.user.uid });

        if (!task) return res.status(404).json({ message: 'Task not found' });

        task.reminderTime = reminderTime ? new Date(reminderTime) : null;
        task.hasReminder = !!reminderTime;
        await task.save();

        res.json(task);
    } catch (error) {
        console.error('Error setting reminder:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Analyze Wheel of Life data
// @route   POST /api/todos/analyze
router.post('/analyze', protect, async (req, res) => {
    try {
        const { sectors } = req.body;
        const sectorSummary = sectors.map(s => {
            const active = s.activeTaskCount || 0;
            const completed = s.completedTaskCount || 0;
            const total = active + completed;
            return `${s.title}: ${completed}/${total} completed (${active} active)`;
        }).join('\n');

        const systemPrompt = `
        You are Gabby Beckford (The Delulu Coach). You analyze people's "Wheel of Life" (balance of life areas).
        The user will provide their completion stats for different life areas.
        Your job is to provide ONE sassy, high-energy, and insightful "Main Character" suggestion (max 50 words).
        If one area is lagging, call it out lovingly. If they are killing it, celebrate but keep them humble.
        Be specific, motivational, and a bit "delulu".
        `;

        const userPrompt = `Here is my current life balance:\n${sectorSummary}\n\nWhat's your "Delulu Coach" take?`;

        const suggestion = await generateAIResponse(systemPrompt, userPrompt);

        res.json({ suggestion });
    } catch (error) {
        console.error('AI Analysis Error:', error);
        res.status(500).json({ message: 'AI Analysis failed' });
    }
});

module.exports = router;
