const express = require('express');
const router = express.Router();
const Mood = require('../models/Mood');
const { protect } = require('../middleware/authMiddleware');
const { generateAIResponse, cleanAIResponse } = require('../services/aiService');

// @desc    Get user moods (optional year and month filter)
// @route   GET /api/mood?year=YYYY&month=MM
router.get('/', protect, async (req, res) => {
    try {
        const { year, month } = req.query;
        let query = { firebaseUid: req.user.uid };

        if (year && month) {
            const formattedMonth = month.toString().padStart(2, '0');
            query.date = { $regex: `^${year}-${formattedMonth}` };
        } else if (year) {
            query.date = { $regex: `^${year}-` };
        }

        const moods = await Mood.find(query).sort({ date: 1 });
        res.json(moods);
    } catch (error) {
        console.error('[Mood] Error fetching moods:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Create or update mood for a date
// @route   POST /api/mood
router.post('/', protect, async (req, res) => {
    const { date, moodScore, emoji, remark } = req.body;

    if (!date || !moodScore || !emoji) {
        return res.status(400).json({ message: 'date, moodScore, and emoji are required' });
    }

    // Validate date format YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
        return res.status(400).json({ message: 'date must be in YYYY-MM-DD format' });
    }

    try {
        const score = parseInt(moodScore, 10);
        if (isNaN(score) || score < 1 || score > 5) {
            return res.status(400).json({ message: 'moodScore must be between 1 and 5' });
        }

        const mood = await Mood.findOneAndUpdate(
            { firebaseUid: req.user.uid, date },
            {
                moodScore: score,
                emoji,
                remark: (remark || '').trim(),
                updatedAt: new Date()
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        res.status(200).json(mood);
    } catch (error) {
        console.error('[Mood] Error logging mood:', error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    AI Pattern Analysis on Moods
// @route   POST /api/mood/analyze
router.post('/analyze', protect, async (req, res) => {
    try {
        const { year, month } = req.body;
        let query = { firebaseUid: req.user.uid };

        if (year && month) {
            const formattedMonth = month.toString().padStart(2, '0');
            query.date = { $regex: `^${year}-${formattedMonth}` };
        }

        // Fetch moods (up to 45 recent entries)
        const moods = await Mood.find(query).sort({ date: -1 }).limit(45);

        if (!moods || moods.length === 0) {
            return res.json({
                analysis: "### Welcome to your Vibe Journey! ✨\n\nYou haven't logged any moods yet. Start by rating how you feel today and adding a brief note! Once you log a few days, I'll reveal your personal emotional rhythms, peak energy triggers, and customized actions to elevate your vibes."
            });
        }

        // Re-order chronologically for analysis
        moods.reverse();

        const totalScore = moods.reduce((acc, m) => acc + m.moodScore, 0);
        const avgScore = (totalScore / moods.length).toFixed(1);

        const moodSummary = moods.map(m => {
            const remarkText = m.remark ? ` - "${m.remark}"` : '';
            return `${m.date}: ${m.emoji} (Score: ${m.moodScore}/5)${remarkText}`;
        }).join('\n');

        const systemPrompt = `
You are Gabby Beckford (The Delulu Coach) — confident, deeply encouraging, sassy, and insightful.
Analyze the user's logged mood patterns and daily reflections.
Provide:
1. **Vibe Check Summary**: A sharp, empowering breakdown of their emotional rhythm (spot trends, what makes them thrive, what causes dips).
2. **Key Patterns & Insights**: 2-3 specific observations based on their logged remarks or weekend vs weekday trends.
3. **3 Delulu Action Steps**: Three practical, mood-boosting, and fun things they should do next to sustain or lift their momentum.

Format response in clean GitHub Markdown with cheerful emojis.
`;

        const userPrompt = `
Here is my recent mood log (${moods.length} entries recorded):
Average Vibe Score: ${avgScore} / 5

Daily Logs:
${moodSummary}

Give me your authentic Delulu Coach vibe analysis!
`;

        const rawAi = await generateAIResponse(systemPrompt, userPrompt);
        const cleaned = cleanAIResponse(rawAi);

        res.json({ analysis: cleaned });
    } catch (error) {
        console.error('[Mood] Error analyzing moods:', error);
        res.status(500).json({
            analysis: "### Delulu Coach is taking a breath! 💨\n\nYour momentum is still valid! Keep tracking your daily vibes and try analyzing again in a moment."
        });
    }
});

module.exports = router;
