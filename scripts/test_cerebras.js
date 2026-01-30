const Cerebras = require('@cerebras/cerebras_cloud_sdk');
require('dotenv').config({ path: './.env' });

const client = new Cerebras({
    apiKey: process.env.CEREBRAS_API_KEY
});

async function testGeneration() {
    console.log("Testing Cerebras API with gpt-oss-120b...");

    if (!process.env.CEREBRAS_API_KEY) {
        console.error("❌ CEREBRAS_API_KEY is missing from .env");
        return;
    }

    const systemMessage = `
    You are the Delulu Coach.
    Output Format: Return EXACTLY a Valid JSON Array of objects. No markdown formatting.
    Each object must have: "title", "description", "duration".
    `;

    const userMessage = `
    Task: Convert the user's dream into 3 micro-actions.
    Dream: "Become a Space Pirate"
    `;

    try {
        const completion = await client.chat.completions.create({
            messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: userMessage }
            ],
            model: 'gpt-oss-120b',
            temperature: 0.7,
            max_completion_tokens: 1000
        });

        const rawText = completion.choices[0].message.content;
        console.log("\nRaw Output:\n", rawText);

        // Simple parse logic from route
        let cleanText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        const firstBracket = cleanText.indexOf('[');
        const lastBracket = cleanText.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket !== -1) {
            cleanText = cleanText.substring(firstBracket, lastBracket + 1);
        }

        const json = JSON.parse(cleanText);
        console.log("\n✅ Parsed JSON Successfully:");
        console.log(JSON.stringify(json, null, 2));

    } catch (error) {
        console.error("\n❌ Error:", error);
    }
}

testGeneration();
