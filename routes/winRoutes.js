const express = require('express');
const router = express.Router();
const Win = require('../models/Win');
const { protect } = require('../middleware/authMiddleware');
async function generateHype(actionTitle) {
    try {
        const Cerebras = require('@cerebras/cerebras_cloud_sdk');
        const client = new Cerebras({ apiKey: process.env.CEREBRAS_API_KEY });

        const systemPrompt = `
        You are Gabby Beckford (The Delulu Coach).
        The user just completed a "Little Win": "${actionTitle}".
        
        1. Write ONE sentence of extreme, sassy, main-character-energy hype (max 20 words).
        2. Pick ONE relevant emoji that best fits this win (e.g., 🏋️‍♀️ for workout, 💻 for code).
        
        Return ONLY valid JSON:
        { "hype": "Your hype sentence here", "icon": "🎉" }
        `;

        const response = await client.chat.completions.create({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Win: ${actionTitle}` }
            ],
            model: 'llama3.3-70b',
            response_format: { type: "json_object" }
        });

        let rawContent = response.choices[0].message.content;
        // Strip markdown code blocks if present
        if (rawContent.includes('```')) {
            rawContent = rawContent.replace(/```json/g, '').replace(/```/g, '');
        }

        const content = JSON.parse(rawContent.trim());
        return {
            hype: content.hype || "You did that!",
            icon: content.icon || "✨"
        };
    } catch (error) {
        console.error("Cerebras Hype Error:", error);
        return {
            hype: "You did that! (AI is catching its breath, but you're unstoppable)",
            icon: "✨"
        };
    }
}

// @desc    Save a new Win and get Hype
// @route   POST /api/wins
// @access  Private
router.post('/', protect, async (req, res) => {
    const { title, type } = req.body;

    if (!title) {
        return res.status(400).json({ message: 'Title is required' });
    }

    try {
        // 1. Generate Hype & Icon
        const aiResult = await generateHype(title);

        // 2. Save to DB
        const win = await Win.create({
            firebaseUid: req.user.uid,
            title,
            type: type || 'mini',
            hypeComment: aiResult.hype,
            icon: aiResult.icon
        });

        res.status(201).json(win);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Get user wins (Little Wins / Side Quests)
// @route   GET /api/wins
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const wins = await Win.find({ firebaseUid: req.user.uid }).sort({ createdAt: -1 });
        res.json(wins);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

module.exports = router;
