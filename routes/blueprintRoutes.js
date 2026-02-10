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

// Helper: Generate Hype Text
async function generateHypeText(questTitle) {
    const systemMessage = `
    You are the Delulu Coach (Gabby Beckford). 
    Your goal is to make the user feel like the main character of their life.
    
    Write a short, sassy, high-energy congratulatory message (1-2 sentences).
    Use emojis. Be dramatic. Remind them they are the main character.
    Examples:
    "The room is empty and you just filled it with your brilliance! 💅 ✨"
    "Brick by brick? Honey, you just laid the whole foundation. 🏗️ 🔥"
    `;

    const userMessage = `I just completed the quest: "${questTitle}"`;

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

        return completion.choices[0].message.content.trim().replace(/^"|"$/g, '');
    } catch (e) {
        console.error("Hype Generation Error:", e);
        return "You crushed it! The universe is taking notes! ✨ 🚀";
    }
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

    // 5 Levels Total. Calculate quests PER level dynamically.
    const numLevels = 5;
    const questsPerLevel = Math.ceil(questCount / numLevels);
    const totalItems = (questsPerLevel * numLevels) + numLevels; // Quests + Rewards

    const systemMessage = `
    You are an expert productivity coach. Your goal is to break down big dreams into simple, concrete, and highly actionable steps.
    Use clear, direct language. Avoid marketing jargon, slang, or overly "witty" phrasing. Focus on clarity and utility.
    
    Output Format: Return EXACTLY a Valid JSON Array of objects. No markdown formatting.
    
    CRITICAL STRUCTURE INSTRUCTIONS:
    - Total Levels: ${numLevels}
    - Quests per Level: ${questsPerLevel}
    - Total Items (Quests + Rewards): ${totalItems}
    
    Structure: For each level, generate ${questsPerLevel} quests followed by 1 reward.
    Pattern: [Q1, Q2, ..., Q${questsPerLevel}, R1], [Q${questsPerLevel + 1}, ..., R2], ...
    
    Object Format (Quest):
    - "title": (string) Clear and descriptive title (3-6 words).
    - "description": (string) 1-2 sentences explaining exactly what to do.
    - "duration": (integer) Minutes (e.g., 15, 30).
    - "type": "quest"
    
    Object Format (Reward):
    - "title": (string) "Level [N] Reward"
    - "description": (string) A fun, rejuvenating, or tailored reward idea based on the dream context.
    - "duration": 0
    - "type": "reward"
    `;

    const userMessage = `
    Task: Convert the user's dream into ${questCount} quests across ${numLevels} levels.
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
        console.log(`[Blueprint DEBUG] Raw AI Response:\n${rawText.substring(0, 500)}...`);

        const questsData = parseAIResponse(rawText);
        console.log(`[Blueprint DEBUG] Parsed questsData count: ${questsData.length}`);
        console.log(`[Blueprint DEBUG] questsPerLevel: ${questsPerLevel}, numLevels: ${numLevels}`);

        // 1. Map AI output to quests (filter out any reward nodes AI might have generated)
        const questsOnly = questsData
            .filter(q => q.type !== 'reward') // Remove any AI-generated rewards
            .map(q => {
                let dur = 15;
                if (typeof q.duration === 'number') dur = q.duration;
                else if (typeof q.duration === 'string') {
                    const match = q.duration.match(/\d+/);
                    dur = match ? parseInt(match[0], 10) : 15;
                }
                return {
                    title: q.title,
                    description: q.description || "Just do it.",
                    checklist: [],
                    duration: dur,
                    isCompleted: false,
                    type: 'quest'
                };
            });

        // 2. SERVER-SIDE REWARD INJECTION
        // IMPORTANT: Trim to exactly questCount to ensure consistent 5 levels
        const trimmedQuests = questsOnly.slice(0, questCount);
        console.log(`[Blueprint DEBUG] AI generated ${questsOnly.length}, trimmed to ${trimmedQuests.length}`);

        // Insert a reward node after every questsPerLevel quests
        const finalQuests = [];
        let levelNum = 1;
        for (let i = 0; i < trimmedQuests.length; i++) {
            finalQuests.push(trimmedQuests[i]);

            // If we've added questsPerLevel quests, inject a reward
            if ((i + 1) % questsPerLevel === 0 && levelNum <= numLevels) {
                finalQuests.push({
                    title: `Level ${levelNum} Reward`,
                    description: `Celebrate completing Level ${levelNum}! Take a break, treat yourself, or reflect on your progress.`,
                    checklist: [],
                    duration: 0,
                    isCompleted: false,
                    type: 'reward'
                });
                levelNum++;
            }
        }

        // Handle edge case: if quests don't divide evenly, add final reward at end
        if (trimmedQuests.length > 0 && trimmedQuests.length % questsPerLevel !== 0 && levelNum <= numLevels) {
            finalQuests.push({
                title: `Level ${levelNum} Reward`,
                description: `Celebrate completing your journey! You've made amazing progress.`,
                checklist: [],
                duration: 0,
                isCompleted: false,
                type: 'reward'
            });
        }

        console.log(`[Blueprint] Generated ${trimmedQuests.length} quests + ${levelNum - 1} rewards = ${finalQuests.length} total items`);
        console.log(`[Blueprint DEBUG] Final quest types: ${finalQuests.map(q => q.type).join(', ')}`);

        res.status(200).json({
            success: true,
            data: finalQuests,
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

        // Response
        let responseData = blueprint.toObject();
        if (req.body.isExplorer === 'true' || req.body.isExplorer === true) {
            console.log(`[Blueprint] Generating celebration for Explorer: ${req.user.uid}`);
            responseData.celebrationMessage = await generateHypeText(questTitle);
        }

        res.json(responseData);

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

        // Response
        let responseData = blueprint.toObject();
        if (req.body.isExplorer === 'true' || req.body.isExplorer === true) {
            console.log(`[Blueprint] Generating celebration for Explorer (PATCH): ${req.user.uid}`);
            responseData.celebrationMessage = await generateHypeText(questTitle);
        }

        res.status(200).json(responseData);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Delete quest evidence photo
// @route   DELETE /api/blueprint/evidence
// @access  Private
router.delete('/evidence', protect, async (req, res) => {
    const { questTitle, blueprintId } = req.body;

    if (!questTitle) {
        return res.status(400).json({ message: 'Quest title is required' });
    }

    try {
        let blueprint;
        if (blueprintId) {
            blueprint = await Blueprint.findOne({ _id: blueprintId, firebaseUid: req.user.uid });
        } else {
            blueprint = await Blueprint.findOne({ firebaseUid: req.user.uid }).sort({ updatedAt: -1 });
        }

        if (!blueprint) {
            return res.status(404).json({ message: 'Blueprint not found' });
        }

        const quest = blueprint.quests.find(q => q.title === questTitle);
        if (!quest) {
            return res.status(404).json({ message: 'Quest not found' });
        }

        // Clear evidence field
        quest.evidenceUrl = undefined;

        await blueprint.save();
        res.status(200).json(blueprint);
    } catch (error) {
        console.error("Delete Evidence Error:", error);
        res.status(500).json({ message: 'Server Error' });
    }
});

// @desc    Generate Hype for Quest Completion
// @route   POST /api/blueprint/hype
// @access  Private
router.post('/hype', protect, async (req, res) => {
    try {
        const { questTitle } = req.body;
        if (!questTitle) return res.status(400).json({ message: "Quest title required" });

        const isExplorer = req.body.isExplorer === 'true' || req.body.isExplorer === true;
        let hypeText = "You crushed it! The universe is taking notes! ✨ 🚀";

        if (isExplorer) {
            hypeText = await generateHypeText(questTitle);
        }

        res.json({ hype: hypeText });
    } catch (error) {
        console.error("Hype Route Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
});

// @desc    Upload Vision Board Image
// @route   POST /api/blueprint/vision-board/upload
// @access  Private
router.post('/vision-board/upload', protect, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    // Return filename for relative path usage on client
    res.json({ url: req.file.filename });
});

// @desc    Save Vision Board Items
// @route   POST /api/blueprint/vision-board/save
// @access  Private
router.post('/vision-board/save', protect, async (req, res) => {
    const { blueprintId, items } = req.body;

    if (!blueprintId || !Array.isArray(items)) {
        return res.status(400).json({ message: "Invalid data" });
    }

    try {
        const blueprint = await Blueprint.findOne({ _id: blueprintId, firebaseUid: req.user.uid });
        if (!blueprint) return res.status(404).json({ message: "Blueprint not found" });

        blueprint.visionBoard = items;
        blueprint.updatedAt = Date.now();

        await blueprint.save();
        res.json({ success: true, data: blueprint.visionBoard });
    } catch (error) {
        console.error("Save VB Error:", error);
        res.status(500).json({ message: "Server Error" });
    }
});


// @desc    Generate Celebration Message
// @route   POST /api/blueprint/celebrate
router.post('/celebrate', protect, async (req, res) => {
    try {
        const { journeyName, questName } = req.body;
        console.log(`[Blueprint] Celebration Request for: ${journeyName} - ${questName || 'Final'}`);

        if (!journeyName) return res.status(400).json({ message: "Journey name required" });

        // Fetch blueprint to get overarching "Dream" context
        const blueprint = await Blueprint.findOne({ firebaseUid: req.user.uid, dream: journeyName });
        const dreamContext = blueprint ? blueprint.dream : journeyName;

        let systemPrompt = `
        You are Gabby Beckford, the Delulu Coach. You are high-energy, sassy, and incredibly supportive.
        Your goal is to make the user feel like the main character of their life.
        Use emojis and dramatic, vivid language.
        `;

        let userPrompt;
        if (questName) {
            userPrompt = `
            Context: The user achieved "${questName}" as part of their journey to "${dreamContext}".
            Task: Write a sassy, high-energy main character message. 
            Constraint: MANDATORY maximum 40 characters. 
            Focus: Mention both the quest and the journey goal if possible.
            `;
        } else {
            userPrompt = `
            The user just CONQUERED their entire journey: "${dreamContext}"!
            Task: Write an epic, dramatic final victory message.
            Constraint: MANDATORY maximum 40 characters.
            `;
        }

        const isExplorer = req.body.isExplorer === 'true' || req.body.isExplorer === true;
        let message = "You did it! You've officially conquered this. Be proud of how far you've come! ✨🚀";

        if (isExplorer) {
            const completion = await client.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                model: 'llama3.1-8b',
                temperature: 0.85,
                max_completion_tokens: 100
            });

            message = completion.choices[0].message.content.trim().replace(/^"|"$/g, '');
        }

        console.log(`[Blueprint] Celebration (Explorer: ${isExplorer}): ${message}`);
        res.status(200).json({ message });
    } catch (error) {
        console.error("Celebration Gen Error:", error);
        res.status(200).json({ message: "You did it! You've officially conquered this. Be proud of how far you've come! ✨🚀" });
    }
});

module.exports = router;
