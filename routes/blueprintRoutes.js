const express = require('express');
const router = express.Router();
const Cerebras = require('@cerebras/cerebras_cloud_sdk'); // Use Cerebras
const Blueprint = require('../models/Blueprint');
const { protect } = require('../middleware/authMiddleware');

// Initialize Cerebras
const client = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY
});

const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = 'uploads/';
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath);
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Unique name
    }
});
const upload = multer({ storage: storage });

// Helper: Clean and Parse JSON from AI response
function parseAIResponse(text) {
    let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

    // Check for obvious refusals (Safety guard)
    const lower = cleanText.toLowerCase();
    if (lower.includes("cannot help") || lower.includes("unable to generate") || lower.includes("sorry")) {
        // If it looks like a refusal and NOT JSON (no brackets), throw specific error
        if (!cleanText.includes('[')) {
            throw new Error("SAFETY_REFUSAL");
        }
    }

    // Attempt 1: Direct Parse
    try {
        return JSON.parse(cleanText);
    } catch (e) {
        // Continue to fallback
    }

    // Fallback: Aggressive Regex
    const match = cleanText.match(/\[.*\]/s);
    if (match) {
        try {
            return JSON.parse(match[0]);
        } catch (e) {
            throw new Error("Failed to parse AI JSON");
        }
    }

    throw new Error("No JSON array found in response");
}

// @desc    Get all blueprints for user
// @route   GET /api/blueprint/list
router.get('/list', protect, async (req, res) => {
    try {
        console.log(`[Blueprint] List Request for User: ${req.user.uid}`);
        const blueprints = await Blueprint.find({ firebaseUid: req.user.uid })
            .sort({ updatedAt: -1 })
            .lean(); // Convert to Plain JS Object

        console.log(`[Blueprint] Found ${blueprints.length} blueprints.`);
        blueprints.forEach((b, i) => {
            console.log(`   [${i}] ID: ${b._id}, Quests: ${b.quests?.length ?? 0}, Updated: ${b.updatedAt}`);
        });

        res.status(200).json(blueprints);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Get specific blueprint
// @route   GET /api/blueprint/:id
router.get('/:id', protect, async (req, res) => {
    try {
        const blueprint = await Blueprint.findOne({ _id: req.params.id, firebaseUid: req.user.uid });
        if (!blueprint) return res.status(404).json({ message: 'Blueprint not found' });
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
            questCount = 30; // Max Limit for fast Cerebras 8b model
        } else if (lowerT.includes('6 months')) {
            questCount = 20;
        } else if (lowerT.includes('3 months')) {
            questCount = 10;
        }
    }

    const systemMessage = `
    You are an expert productivity coach. Your goal is to break down big dreams into simple, concrete, and highly actionable steps.
    Use clear, direct language. Avoid marketing jargon, slang, or overly "witty" phrasing. Focus on clarity and utility.
    
    Output Format: Return EXACTLY a Valid JSON Array of objects. No markdown formatting.
    Each object must have:
    - "title": (string) Clear and descriptive title (3-6 words). Example: "Research Market Competitors" instead of "Scope out the Haters".
    - "description": (string) 1-2 sentences explaining exactly what to do and why. Simple, professional, encouraging tone.
    - "duration": (integer) A realistic duration in MINUTES (e.g., 15, 30, 45, 60).
    `;

    const userMessage = `
    Task: Convert the user's dream into ${questCount} sequential levels (Quests).
    The user wants to achieve this in: "${timeline || 'Unknown timeframe'}".
    The user's current progress is: "${progress || 'Just getting started'}".
    
    Dream: "${dream}"
    `;

    try {
        console.log(`[Blueprint] Attempting generation (Cerebras: llama3.1-8b) for: ${dream.substring(0, 20)}...`);

        const completion = await client.chat.completions.create({
            messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: userMessage }
            ],
            model: 'llama3.1-8b',
            temperature: 0.7,
            max_completion_tokens: 4000
        });

        const rawText = completion.choices[0].message.content;
        const questsData = parseAIResponse(rawText);

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
                checklist: [], // Empty initially
                duration: dur,
                isCompleted: false
            };
        });

        res.status(200).json({
            success: true,
            data: quests,
            saved: false
        });
    } catch (error) {
        console.error('Blueprint Generation Error:', error);

        if (error.message === "SAFETY_REFUSAL") {
            return res.status(400).json({
                success: false,
                message: 'SAFETY_REFUSAL',
                error: 'Safety refusal.'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to generate blueprint',
            error: error.message
        });
    }
});

// @desc    Generate Tasks for a specific Quest
// @route   POST /api/blueprint/generate-tasks
// @access  Private
router.post('/generate-tasks', protect, async (req, res) => {
    const { questTitle, questDescription, dream } = req.body;

    const systemMessage = `
    You are an expert productivity coach.
    Task: Generate a checklist of 3-5 specific, micro-actions for a user's quest.
    Output: JSON Array of strings. e.g. ["Buy domain name", "Install WordPress", "Choose theme"]
    `;

    const userMessage = `
    Dream: ${dream}
    Quest: ${questTitle}
    Context: ${questDescription}
    `;

    try {
        const completion = await client.chat.completions.create({
            messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: userMessage }
            ],
            model: 'llama3.1-8b',
            temperature: 0.7,
            max_completion_tokens: 1000
        });

        const rawText = completion.choices[0].message.content;

        // Parse array of strings
        let checklist = [];
        try {
            checklist = parseAIResponse(rawText);
            // Handle if it returned objects instead of strings
            if (checklist.length > 0 && typeof checklist[0] !== 'string') {
                checklist = checklist.map(i => i.task || i.action || JSON.stringify(i));
            }
        } catch (e) {
            checklist = ["Just do it", "Mark as done"];
        }

        res.json({ checklist });
    } catch (error) {
        console.error("Task Gen Error:", error);
        res.status(500).json({ message: "Failed to generate tasks" });
    }
});

// @desc    Save existing blueprint (e.g. after registration)
// @route   POST /api/blueprint/save
// @access  Private
router.post('/save', protect, async (req, res) => {
    const { dream, quests, saveAsNew } = req.body;

    console.log(`[Blueprint] Save Request. User: ${req.user.uid}`);
    console.log(`[Blueprint] Data - Dream: ${dream}, Quests: ${quests?.length}, New: ${saveAsNew}`);

    if (!quests || !Array.isArray(quests)) {
        console.error("[Blueprint] Save Failed: Quests is not an array");
        return res.status(400).json({ message: 'Quests array is required' });
    }

    try {
        let blueprint;
        if (saveAsNew) {
            console.log("[Blueprint] Creating NEW blueprint...");
            blueprint = await Blueprint.create({
                firebaseUid: req.user.uid,
                dream: dream || "My Delusional Dream",
                quests,
                updatedAt: Date.now()
            });
        } else {
            // Update latest or create if none
            console.log("[Blueprint] Updating EXISTING blueprint...");
            blueprint = await Blueprint.findOneAndUpdate(
                { firebaseUid: req.user.uid },
                {
                    dream: dream || "My Delusional Dream",
                    quests,
                    updatedAt: Date.now()
                },
                {
                    new: true,
                    upsert: true,
                    sort: { updatedAt: -1 },
                    runValidators: true // CRITICAL: Enforce schema validation on update
                }
            );
        }

        console.log(`[Blueprint] Saved Successfully. ID: ${blueprint._id}, Quests Saved: ${blueprint.quests?.length}`);
        res.status(200).json({ success: true, data: blueprint });
    } catch (error) {
        console.error('Blueprint Save Error:', error);
        res.status(500).json({ message: 'Failed to save blueprint: ' + error.message });
    }
});

// @access  Private
// @desc    Complete a quest with optional photo evidence
router.post('/complete-with-evidence', protect, upload.single('evidence'), async (req, res) => {
    const { questTitle, blueprintId } = req.body;
    // req.file contains the uploaded file info

    try {
        let blueprint;
        if (blueprintId) {
            blueprint = await Blueprint.findOne({ _id: blueprintId, firebaseUid: req.user.uid });
        } else {
            // Fallback to most recent (legacy support)
            blueprint = await Blueprint.findOne({ firebaseUid: req.user.uid }).sort({ updatedAt: -1 });
        }

        if (!blueprint) return res.status(404).json({ message: "Blueprint not found" });

        const quest = blueprint.quests.find(q => q.title === questTitle);
        if (!quest) return res.status(404).json({ message: "Quest not found" });

        quest.isCompleted = true;
        if (req.file) {
            quest.evidenceUrl = req.file.filename;
        }

        await blueprint.save();
        res.json(blueprint);

    } catch (error) {
        console.error("Complete Evidence Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

// @desc    Mark a quest as complete (Legacy/No-Photo)
// @access  Private   PATCH /api/blueprint/complete
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

// @desc    Generate Hype for Quest Completion
// @route   POST /api/blueprint/hype
// @access  Private
router.post('/hype', protect, async (req, res) => {
    const { questTitle } = req.body;

    if (!questTitle) return res.status(400).json({ message: "Quest title required" });

    const systemMessage = `
    You are the Delulu Coach (Gabby Beckford). 
    Your user just completed the quest: "${questTitle}".
    
    Write a short, sassy, high-energy congratulatory message (1-2 sentences).
    Use emojis. Be dramatic. Remind them they are the main character.
    Examples:
    "The room is empty and you just filled it with your brilliance! 💅 ✨"
    "Brick by brick? Honey, you just laid the whole foundation. 🏗️ 🔥"
    `;

    try {
        const completion = await client.chat.completions.create({
            messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: userMessage }
            ],
            model: 'llama3.1-8b',
            temperature: 0.8,
            max_completion_tokens: 150
        });

        const hypeText = completion.choices[0].message.content.trim();
        res.json({ hype: hypeText });
    } catch (error) {
        console.error("Hype Gen Error:", error);
        res.json({ hype: "You crushed it! The universe is taking notes! ✨ 🚀" }); // Fallback
    }
});

module.exports = router;
