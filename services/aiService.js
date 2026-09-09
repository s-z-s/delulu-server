const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURATION ---
const TIMEOUT_MS = 8000;

// Initialize Clients
function getGroqClient() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey.trim() === '') return null;
    return new Groq({ apiKey });
}

function getGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === '') return null;
    return new GoogleGenerativeAI(apiKey);
}

// Model Fallback Chains (Free-Tier Optimized)
const GROQ_MODELS = [
    "openai/gpt-oss-120b",
    "qwen/qwen3.8-27b",
    "openai/gpt-oss-20b",
    "groq/compound-mini",
    "qwen/qwen3.6-27b",
    "groq/compound"
];

const GEMINI_MODELS = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-flash-latest"
];

// --- HELPER FUNCTIONS ---

/**
 * Clean AI response (remove think tags and markdown code blocks)
 */
function cleanAIResponse(text) {
    if (!text) return "";
    let clean = text.trim();
    // Strip <think> tags from reasoning models (e.g. Qwen 3.6)
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Remove markdown code blocks if present
    clean = clean.replace(/```json/gi, '').replace(/```/g, '').trim();
    return clean;
}

/**
 * Call Groq with model fallback and timeout
 */
async function callGroqChain(systemPrompt, userPrompt) {
    const groqClient = getGroqClient();
    if (!groqClient) {
        throw new Error("GROQ_API_KEY is not configured");
    }

    for (const modelName of GROQ_MODELS) {
        try {
            console.log(`[AI Service] Attempting Groq Model: ${modelName}...`);

            const groqPromise = groqClient.chat.completions.create({
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                model: modelName,
                temperature: 0.7,
                max_completion_tokens: 4000
            });

            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Groq Timeout (${modelName})`)), TIMEOUT_MS)
            );

            const completion = await Promise.race([groqPromise, timeoutPromise]);
            const rawContent = completion.choices?.[0]?.message?.content;
            if (rawContent) {
                // Clean any reasoning tags if present
                const cleaned = rawContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                return cleaned || rawContent.trim();
            }
        } catch (error) {
            console.warn(`[AI Service] Groq ${modelName} Failed (${error.status || error.message}): switching to next model...`);
        }
    }
    throw new Error("All Groq models failed.");
}

/**
 * Call Gemini Chain with timeout
 */
async function callGeminiChain(systemPrompt, userPrompt) {
    const genAI = getGeminiClient();
    if (!genAI) {
        throw new Error("GEMINI_API_KEY is not configured");
    }

    for (const modelName of GEMINI_MODELS) {
        try {
            console.log(`[AI Service] Attempting Gemini Model: ${modelName}...`);
            const model = genAI.getGenerativeModel({ model: modelName });

            const generatePromise = model.generateContent(`${systemPrompt}\n\n${userPrompt}`);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Gemini Timeout (${modelName})`)), TIMEOUT_MS)
            );

            const result = await Promise.race([generatePromise, timeoutPromise]);
            const response = await result.response;
            const text = response.text();
            if (text) return text;

        } catch (error) {
            console.warn(`[AI Service] Gemini ${modelName} Failed: ${error.message}`);
        }
    }
    throw new Error("All Gemini models failed.");
}

// --- MAIN EXPORT ---

/**
 * Generate AI Response with Robust Free-Tier Fallback Strategy:
 * 1. Groq (Llama 3.3 70B -> Llama 3.1 8B Instant)
 * 2. Gemini Chain (2.5 Flash -> 2.5 Flash-Lite -> 3.6 Flash -> 3.5 Flash -> Flash Latest)
 * 
 * @param {string} systemPrompt - The system instruction
 * @param {string} userPrompt - The user's input/context
 * @returns {Promise<string>} - The AI generated text
 */
async function generateAIResponse(systemPrompt, userPrompt) {
    // 1. Try Groq if configured
    if (process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim() !== '') {
        try {
            return await callGroqChain(systemPrompt, userPrompt);
        } catch (groqError) {
            console.warn(`[AI Service] Groq Provider Failed: ${groqError.message}`);
        }
    }

    // 2. Try Gemini Chain
    try {
        return await callGeminiChain(systemPrompt, userPrompt);
    } catch (geminiError) {
        console.warn(`[AI Service] Gemini Chain Failed: ${geminiError.message}`);
        throw new Error(`AI Generation Failed: ${geminiError.message}`);
    }
}

module.exports = {
    generateAIResponse,
    cleanAIResponse
};
