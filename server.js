const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const connectDB = require('./config/db');

dotenv.config();

connectDB();

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads')); // Serve uploaded files
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from public folder

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

app.get('/api/test', (req, res) => {
    console.log('Test route hit!');
    res.send('API Test Working');
});

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/blueprint', require('./routes/blueprintRoutes'));
app.use('/api/wins', require('./routes/winRoutes'));
app.use('/api/side-quests', require('./routes/sideQuestRoutes'));
app.use('/api/todos', require('./routes/todoRoutes'));
app.use('/api/user', require('./routes/userRoutes'));
app.use('/api/theme', require('./routes/themeRoutes'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/privacy-policy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy-policy.html'));
});

// Custom 404 handler for debugging
app.use((req, res, next) => {
    console.log(`404 Not Found for: ${req.method} ${req.url}`);
    res.status(404).send(`Cannot ${req.method} ${req.url}`);
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
