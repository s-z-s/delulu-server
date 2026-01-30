require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY not found in .env");
    process.exit(1);
}

async function listModels() {
    // Hack: The Node SDK doesn't have a direct listModels method exposed easily on the instance top-level in all versions, 
    // but we can try to use the API or just test a few standard ones.
    // Actually, let's just test-run 'gemini-1.5-flash' and 'gemini-pro' and see which one doesn't throw.

    // Better yet, use the REST API via fetch to list if SDK fails.
    const key = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;

    try {
        const response = await fetch(url);
        const data = await response.json();

        if (data.models) {
            console.log("AVAILABLE MODELS:");
            data.models.forEach(m => console.log(`- ${m.name}`));
        } else {
            console.log("No models found or error structure:", data);
        }
    } catch (e) {
        console.error("Error fetching models:", e);
    }
}

listModels();
