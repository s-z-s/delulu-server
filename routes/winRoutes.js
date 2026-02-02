const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Win = require('../models/Win');
const { protect } = require('../middleware/authMiddleware');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Models verified via list_models.js script
const MODELS = [
    'gemini-2.5-flash-lite', // Try lite first for speed/stability
    'gemini-flash-latest',   // Generic alias that usually works
    'gemini-2.0-flash',      // Stable previous version
    'gemini-2.0-flash-lite',
    'gemini-2.5-flash',      // Available but was timing out, move lower
    'gemini-1.5-flash-001'   // Keep as legacy backup
];

// Helper wrapper to timeout promises
const timeout = (prom, time) =>
    Promise.race([
        prom,
        new Promise((_r, rej) => setTimeout(() => rej(new Error('Request timed out')), time))
    ]);

async function generateHype(actionTitle) {
    let lastError = null;

    const prompt = `
    You are the Delulu Coach (Gabby Beckford). 
    The user just completed this action: "${actionTitle}".
    
    Write ONE sentence of extreme, sassy, main-character-energy hype.
    Tell them they just outworked everyone. Use the phrase "The room is empty" or "Boarding pass printed" if relevant.
    Make it short and punchy.
    `;

    for (const modelName of MODELS) {
        try {
            console.log(`[Hype] Attempting with model: ${modelName}`);
            const model = genAI.getGenerativeModel({ model: modelName });

            // 8 second timeout
            const result = await timeout(
                model.generateContent(prompt),
                8000
            );

            const response = await result.response;
            const text = response.text().trim();
            console.log(`[Hype] Success with ${modelName}!`);
            return text;
        } catch (error) {
            const errorMsg = error ? error.message : "Unknown error";
            console.warn(`[Hype] Failed with ${modelName}: ${errorMsg}`);
            lastError = error;
            // Continue to next model
        }
    }

    console.error("All Gemini Hype models failed. Returning fallback.");
    // Fallback if AI fails completely so DB save still happens
    return "You did that! (AI is catching its breath, but you're unstoppable)";
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
        // 1. Generate Hype with fail-safe
        const hypeComment = await generateHype(title);

        // 2. Save to DB
        const win = await Win.create({
            firebaseUid: req.user.uid,
            title,
            type: type || 'mini',
            hypeComment
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
