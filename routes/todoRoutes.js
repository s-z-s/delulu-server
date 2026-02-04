const express = require('express');
const router = express.Router();
const Sector = require('../models/Sector');
const Task = require('../models/Task');
const User = require('../models/User');
const { protect } = require('../middleware/authMiddleware');

// === SECTORS ===

// @desc    Get all sectors with task counts
// @route   GET /api/todos/sectors
router.get('/sectors', protect, async (req, res) => {
    try {
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
                                active: { $sum: { $cond: [{ $ne: ['$isCompleted', true] }, 1, 0] } },
                                completed: { $sum: { $cond: [{ $eq: ['$isCompleted', true] }, 1, 0] } }
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

module.exports = router;
