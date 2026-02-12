const Cerebras = require('@cerebras/cerebras_cloud_sdk');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require('axios');

// --- CONFIGURATION ---
const TIMEOUT_MS = 5000;

// Initialize Clients
const cerebrasClient = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Fallback Chain
const GEMINI_MODELS = [
    "gemini-2.0-flash",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite"
];

// --- HELPER FUNCTIONS ---

/**
 * Clean AI response (remove markdown code blocks)
 */
function cleanAIResponse(text) {
    if (!text) return "";
    let clean = text.trim();
    // Remove markdown code blocks if present
    clean = clean.replace(/```json/g, '').replace(/```/g, '');
    return clean;
}

/**
 * Call Cerebras with Timeout
 */
async function callCerebras(systemPrompt, userPrompt, model = 'llama3.1-8b') {
    console.log(`[AI Service] Attempting Cerebras (${model})...`);

    const cerebrasPromise = cerebrasClient.chat.completions.create({
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ],
        model: model,
        temperature: 0.7,
        max_completion_tokens: 4000 // Generous token limit, adjusted by timeout
    });

    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Cerebras Timeout")), TIMEOUT_MS)
    );

    const completion = await Promise.race([cerebrasPromise, timeoutPromise]);
    return completion.choices[0].message.content;
}

/**
 * Call Gemini Chain with Timeout
 */
async function callGeminiChain(systemPrompt, userPrompt) {
    for (const modelName of GEMINI_MODELS) {
        try {
            console.log(`[AI Service] Attempting Gemini Model: ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });

            const generatePromise = model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Gemini Timeout")), TIMEOUT_MS)
            );

            const result = await Promise.race([generatePromise, timeoutPromise]);
            const response = await result.response;
            return response.text();

        } catch (error) {
            console.warn(`[AI Service] ${modelName} Failed: ${error.message}`);
        }
    }
    throw new Error("All Gemini models failed.");
}

/**
 * Call Perplexity (Sonar) with Timeout
 */
async function callPerplexity(systemPrompt, userPrompt) {
    console.log("[AI Service] Attempting Perplexity Sonar...");
    try {
        const response = await axios.post('https://api.perplexity.ai/chat/completions', {
            model: 'sonar',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ]
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.PERPLEXITY_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: TIMEOUT_MS
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.warn(`[AI Service] Perplexity Failed: ${error.message}`);
        throw error;
    }
}

// --- MAIN EXPORT ---

/**
 * Generate AI Response with Robust Fallback Strategy
 * 1. Cerebras (Llama 3.1 8b)
 * 2. Gemini Chain (2.0 Flash -> 2.5 -> Lite)
 * 3. Perplexity (Sonar)
 * 
 * @param {string} systemPrompt - The system instruction
 * @param {string} userPrompt - The user's input/context
 * @returns {Promise<string>} - The AI generated text
 */
async function generateAIResponse(systemPrompt, userPrompt) {
    // 1. Try Cerebras
    try {
        return await callCerebras(systemPrompt, userPrompt);
    } catch (cerebrasError) {
        console.warn(`[AI Service] Cerebras Failed: ${cerebrasError.message}`);

        // 2. Try Gemini Chain
        try {
            return await callGeminiChain(systemPrompt, userPrompt);
        } catch (geminiError) {
            console.warn(`[AI Service] Gemini Chain Failed: ${geminiError.message}`);

            // 3. Try Perplexity
            try {
                return await callPerplexity(systemPrompt, userPrompt);
            } catch (perpError) {
                console.error("[AI Service] CRITICAL: All AI Providers Failed.");
                throw new Error("AI Generation Service Failed (All Providers)");
            }
        }
    }
}

module.exports = {
    generateAIResponse,
    cleanAIResponse
};
