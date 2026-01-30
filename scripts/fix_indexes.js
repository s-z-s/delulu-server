const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' }); // Path relative to CWD

const fixIndexes = async () => {
    try {
        console.log("Connecting to DB...");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connected.");

        const collection = mongoose.connection.collection('blueprints');

        // List indexes to verify
        const indexes = await collection.indexes();
        console.log("Current Indexes:", indexes);

        const indexName = 'firebaseUid_1';
        const exists = indexes.some(idx => idx.name === indexName);

        if (exists) {
            console.log(`Dropping index: ${indexName}...`);
            await collection.dropIndex(indexName);
            console.log("Index dropped successfully.");
        } else {
            console.log(`Index ${indexName} not found.`);
        }

        console.log("Done.");
        process.exit(0);
    } catch (error) {
        console.error("Error fixing indexes:", error);
        process.exit(1);
    }
};

fixIndexes();
