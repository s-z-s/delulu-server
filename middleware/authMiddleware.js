const admin = require('firebase-admin');

// Initialize Firebase Admin (assumes GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT is set)
// Or we can rely on parsing the JSON from the env var if it's a string
if (!admin.apps.length) {
    let serviceAccount; // Declare serviceAccount here to be accessible later
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        console.warn("FIREBASE_SERVICE_ACCOUNT is not set in .env");
    } else {
        try {
            // Try parsing as JSON
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            console.log("Loaded Firebase credentials from JSON string");
        } catch (e) {
            // If JSON parse fails, check if it's a file path
            console.warn(`Could not parse FIREBASE_SERVICE_ACCOUNT as JSON (${e.message}). Treating as file path...`);
            try {
                // We require 'path' module if we use it, but admin.credential.cert accepts a path string? 
                // No, cert() takes an object or path? cert(serviceAccountPathOrObject)
                // Actually admin.credential.cert() expects an object. admin.credential.cert(require('path/to/file.json')) works.
                // admin.credential.cert('path/to/file.json') does NOT work directly in some versions? 
                // Let's use `require` logic.
                const path = require('path');
                // Remove quotes if present
                let filePath = process.env.FIREBASE_SERVICE_ACCOUNT.replace(/["']/g, '');
                // resolving relative to cwd (delulu-server)
                filePath = path.resolve(process.cwd(), filePath);
                serviceAccount = require(filePath);
                console.log(`Loaded Firebase credentials from file: ${filePath}`);
            } catch (fileErr) {
                console.error("Failed to load Firebase credentials as file path:", fileErr.message);
            }
        }
    }

    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } else {
        console.log("Initializing Firebase Admin with Default Credentials (ADC)...");
        admin.initializeApp();
    }
}

const protect = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        try {
            token = req.headers.authorization.split(' ')[1];
            console.log(`Verifying token: ${token.substring(0, 10)}...`);

            const decodedToken = await admin.auth().verifyIdToken(token);
            console.log('Token verified successfully for uid:', decodedToken.uid);
            req.user = decodedToken;
            next();
        } catch (error) {
            console.error('Token verification failed:', error.code, error.message);
            res.status(401).json({ message: 'Not authorized, token failed', error: error.message });
        }
    } else {
        res.status(401).json({ message: 'Not authorized, no token' });
    }
};

module.exports = { protect };
