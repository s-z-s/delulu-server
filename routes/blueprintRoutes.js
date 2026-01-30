const express = require('express');
const router = express.Router();
const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const Blueprint = require('../models/Blueprint');
const { protect } = require('../middleware/authMiddleware');

// Initialize Cerebras
const client = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY
});

// Helper: Clean and Parse JSON from AI response
function parseAIResponse(text) {
    let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

    // Attempt 1: Direct Parse
    try {
        const firstBracket = cleanText.indexOf('[');
        const lastBracket = cleanText.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) {
            const candidate = cleanText.substring(firstBracket, lastBracket + 1);
            return JSON.parse(candidate);
        }
    } catch (e) {
        // Continue to repair
    }

    // Attempt 2: Repair Truncated JSON
    try {
        const firstBracket = cleanText.indexOf('[');
        if (firstBracket === -1) throw new Error("No JSON array start found");

        // Find the last complete object ending '}'
        const lastClosingBrace = cleanText.lastIndexOf('}');
        if (lastClosingBrace === -1) throw new Error("No complete objects found");

        // Construct valid array
        const repairedText = cleanText.substring(firstBracket, lastClosingBrace + 1) + ']';
        return JSON.parse(repairedText);
    } catch (e) {
        console.error("JSON Repair Failed:", e);
        console.error("Raw Text:", text);
        throw new Error("Failed to parse AI response as JSON");
    }
}

// @desc    Get all blueprints for current user
// @route   GET /api/blueprint/list
// @access  Private
router.get('/list', protect, async (req, res) => {
    try {
        const blueprints = await Blueprint.find({ firebaseUid: req.user.uid }).sort({ updatedAt: -1 });
        res.status(200).json(blueprints);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Get latest blueprint (Compat)
// @route   GET /api/blueprint
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const blueprint = await Blueprint.findOne({ firebaseUid: req.user.uid }).sort({ updatedAt: -1 });
        if (!blueprint) {
            return res.status(404).json({ message: 'No blueprint found' });
        }
        res.status(200).json(blueprint);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Generate Blueprint (Optional Auth)
// @route   POST /api/blueprint/generate
// @access  Public (Optional Auth for Saving)
router.post('/generate', async (req, res) => {
    // Manually check for token if present to support "Save if logged in"
    const admin = require('firebase-admin');

    let userUid = null;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            const token = req.headers.authorization.split(' ')[1];
            const decodedToken = await admin.auth().verifyIdToken(token);
            userUid = decodedToken.uid;
        } catch (e) {
            console.warn("Generating without auth (token invalid/expired):", e.message);
        }
    }

    const { dream, timeline, progress } = req.body;

    if (!dream) {
        return res.status(400).json({ message: 'Dream is required' });
    }

    // Determine quest count based on timeline
    let questCount = 5; // Default
    if (timeline) {
        const lowerT = timeline.toLowerCase();
        if (lowerT.includes('year') || lowerT.includes('12 months')) {
            questCount = 60;
        } else if (lowerT.includes('6 months')) {
            questCount = 30;
        } else if (lowerT.includes('3 months')) {
            questCount = 15;
        }
    }

    const systemMessage = `
    You are the Delulu Coach (Gabby Beckford). Your philosophy is that 'The Room Is Empty'. 
    When a user hesitates, remind them that statistically, nobody else applied. 
    Use the phrase 'Brick by Brick'.
    
    Output Format: Return EXACTLY a Valid JSON Array of objects. No markdown formatting.
    Each object must have:
    - "title": (string) Short, punchy, 3-5 words max. Strong verbs.
    - "description": (string) 1-2 short sentences on HOW to do it. Practical advice. Sassy tone.
    - "duration": (integer) A realistic duration in MINUTES for this specific task (e.g., 15, 30, 45, 60, 90). 
      - Simple tasks (e.g., sending an email) should be 15-30 mins.
      - Deep work (e.g., drafting a chapter) should be 45-90 mins.
    `;

    const userMessage = `
    Task: Convert the user's dream into ${questCount} immediate micro-actions (Side Quests).
    The user wants to achieve this in: "${timeline || 'Unknown timeframe'}".
    The user's current progress is: "${progress || 'Just getting started'}".
    - If they are advanced, give them harder quests.
    - If they are just starting, give them foundational quests.
    
    Dream: "${dream}"
    `;

    try {
        console.log(`[Blueprint] Attempting generation with Cerebras (gpt-oss-120b) for: ${dream.substring(0, 20)}...`);

        const completion = await client.chat.completions.create({
            messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: userMessage }
            ],
            model: 'gpt-oss-120b',
            temperature: 0.7,
            max_completion_tokens: 4000
        });

        const rawText = completion.choices[0].message.content;
        const questsData = parseAIResponse(rawText);

        // Map to schema format (add isCompleted: false)
        const quests = questsData.map(q => {
            let dur = 15;
            if (typeof q.duration === 'number') dur = q.duration;
            else if (typeof q.duration === 'string') {
                const match = q.duration.match(/\d+/);
                dur = match ? parseInt(match[0], 10) : 15;
            }
            return {
                title: q.title,
                description: q.description || "Just do it.",
                duration: dur,
                isCompleted: false
            };
        });

        // IF authenticated, save to DB
        if (userUid) {
            if (req.body.saveAsNew) {
                // Create new journey
                await Blueprint.create({
                    firebaseUid: userUid,
                    dream,
                    quests,
                    updatedAt: Date.now()
                });
            } else {
                // Update existing or create if none (Onboarding flow)
                await Blueprint.findOneAndUpdate(
                    { firebaseUid: userUid },
                    {
                        dream,
                        quests,
                        updatedAt: Date.now()
                    },
                    { new: true, upsert: true, sort: { updatedAt: -1 } }
                );
            }
        }

        res.status(200).json({
            success: true,
            data: quests, // Return the quests list
            saved: !!userUid
        });
    } catch (error) {
        console.error('Blueprint Generation Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate blueprint',
            error: error.message
        });
    }
});

// @desc    Save existing blueprint (e.g. after registration)
// @route   POST /api/blueprint/save
// @access  Private
router.post('/save', protect, async (req, res) => {
    const { dream, quests, saveAsNew } = req.body;

    if (!quests || !Array.isArray(quests)) {
        return res.status(400).json({ message: 'Quests array is required' });
    }

    try {
        let blueprint;
        if (saveAsNew) {
            blueprint = await Blueprint.create({
                firebaseUid: req.user.uid,
                dream: dream || "My Delusional Dream",
                quests,
                updatedAt: Date.now()
            });
        } else {
            // Update latest or create if none
            blueprint = await Blueprint.findOneAndUpdate(
                { firebaseUid: req.user.uid },
                {
                    dream: dream || "My Delusional Dream",
                    quests,
                    updatedAt: Date.now()
                },
                { new: true, upsert: true, sort: { updatedAt: -1 } }
            );
        }

        res.status(200).json({ success: true, data: blueprint });
    } catch (error) {
        console.error('Blueprint Save Error:', error);
        res.status(500).json({ message: 'Failed to save blueprint' });
    }
});

// @desc    Mark a quest as completed
// @route   PATCH /api/blueprint/complete
// @access  Private
router.patch('/complete', protect, async (req, res) => {
    const { questTitle, blueprintId } = req.body;

    if (!questTitle) {
        return res.status(400).json({ message: 'Quest title is required' });
    }

    try {
        let blueprint;
        if (blueprintId) {
            blueprint = await Blueprint.findOne({ _id: blueprintId, firebaseUid: req.user.uid });
        } else {
            // Fallback: Get latest
            blueprint = await Blueprint.findOne({ firebaseUid: req.user.uid }).sort({ updatedAt: -1 });
        }

        if (!blueprint) {
            return res.status(404).json({ message: 'Blueprint not found' });
        }

        // Find quest by title and mark completed
        let found = false;
        blueprint.quests = blueprint.quests.map(q => {
            if (q.title === questTitle) {
                found = true;
                return { ...q, isCompleted: true };
            }
            return q;
        });

        if (!found) {
            // If not found, ignore
        }

        await blueprint.save();
        res.status(200).json(blueprint);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

module.exports = router;
