const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`MongoDB Connected: ${conn.connection.host}`);

    // Automatic migration for email index (sparse unique)
    try {
      const userCol = conn.connection.collection('users');
      const indexes = await userCol.indexes();
      const emailIndex = indexes.find(idx => idx.name === 'email_1');
      if (emailIndex && !emailIndex.sparse) {
        console.log('[DB] Found non-sparse email_1 index. Dropping for sparse migration...');
        await userCol.dropIndex('email_1');
        console.log('[DB] Dropped legacy email_1 index.');
      }
      // Unset null emails so sparse index works properly
      await userCol.updateMany({ email: null }, { $unset: { email: "" } });
      const User = require('../models/User');
      await User.syncIndexes();
      console.log('[DB] User indexes verified and synchronized.');
    } catch (idxError) {
      console.warn('[DB] Index migration warning:', idxError.message);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
