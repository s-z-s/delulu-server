const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/delulu');
        console.log('MongoDB Connected');

        const users = await User.find({});
        console.log(`Found ${users.length} users.`);

        users.forEach(user => {
            console.log('\n--------------------------------');
            console.log(`User: ${user.email} (UID: ${user.firebaseUid})`);
            console.log('Stats:', JSON.stringify(user.stats, null, 2));
            console.log('Achievements:', JSON.stringify(user.achievements, null, 2));
            console.log('--------------------------------\n');
        });

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

connectDB();
