const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const admin = require('firebase-admin');

// Ensure Firebase is initialized
require('../middleware/authMiddleware');

const User = require('../models/User');
const Blueprint = require('../models/Blueprint');
const Win = require('../models/Win');
const Mood = require('../models/Mood');
const Sector = require('../models/Sector');
const Task = require('../models/Task');
const SideQuest = require('../models/SideQuest');

// Configuration
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'delulu_superadmin_2026';
const ADMIN_SECRET = process.env.ADMIN_SECRET || crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');

// Token Generator (HMAC SHA-256 signed)
function generateAdminToken() {
    const payload = {
        role: 'superadmin',
        issuedAt: Date.now(),
        expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hours
    };
    const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', ADMIN_SECRET).update(data).digest('base64url');
    return `${data}.${signature}`;
}

// Token Verifier
function verifyAdminToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', ADMIN_SECRET).update(data).digest('base64url');
    if (signature !== expectedSig) return null;
    try {
        const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
        if (Date.now() > payload.expiresAt) return null;
        return payload;
    } catch {
        return null;
    }
}

// Admin Auth Middleware
function adminProtect(req, res, next) {
    const authHeader = req.headers.authorization;
    const customHeader = req.headers['x-admin-token'];
    let token = customHeader;

    if (!token && authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }

    const payload = verifyAdminToken(token);
    if (!payload) {
        return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or expired admin token' });
    }

    req.admin = payload;
    next();
}

// Helper: Safely compare strings against timing attacks
function safeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}

// @desc    Admin Login
// @route   POST /api/admin/login
// @access  Public (Password protected)
router.post('/login', (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required' });
        }

        const valid = safeCompare(password.trim(), ADMIN_PASSWORD.trim());
        if (!valid) {
            return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
        }

        const token = generateAdminToken();
        res.json({
            success: true,
            message: 'Authenticated successfully',
            token,
            expiresIn: '24h'
        });
    } catch (err) {
        console.error('[Admin Login Error]:', err);
        res.status(500).json({ success: false, message: 'Server error during admin login' });
    }
});

// @desc    Verify current admin session
// @route   GET /api/admin/verify
// @access  Admin
router.get('/verify', adminProtect, (req, res) => {
    res.json({ success: true, valid: true, expiresAt: req.admin.expiresAt });
});

// @desc    Get App Analytics
// @route   GET /api/admin/analytics
// @access  Admin
router.get('/analytics', adminProtect, async (req, res) => {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [
            totalUsers,
            usersWithEmail,
            newUsersLast7d,
            newUsersLast30d,
            totalBlueprints,
            totalWins,
            totalSideQuests,
            totalSectors,
            totalTasks,
            completedTasks,
            totalMoods
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ email: { $exists: true, $ne: null, $ne: '' } }),
            User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
            User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
            Blueprint.countDocuments(),
            Win.countDocuments(),
            SideQuest.countDocuments(),
            Sector.countDocuments(),
            Task.countDocuments(),
            Task.countDocuments({ isCompleted: true }),
            Mood.countDocuments()
        ]);

        // Uploads disk storage analytics
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        let uploadFilesCount = 0;
        let totalUploadSizeBytes = 0;

        if (fs.existsSync(uploadsDir)) {
            try {
                const files = fs.readdirSync(uploadsDir);
                uploadFilesCount = files.length;
                files.forEach(f => {
                    try {
                        const stat = fs.statSync(path.join(uploadsDir, f));
                        totalUploadSizeBytes += stat.size;
                    } catch {
                        // Ignore file stat errors
                    }
                });
            } catch (fsErr) {
                console.warn('[Admin Analytics] Uploads directory scan warning:', fsErr.message);
            }
        }

        res.json({
            success: true,
            analytics: {
                users: {
                    total: totalUsers,
                    withEmail: usersWithEmail,
                    anonymous: totalUsers - usersWithEmail,
                    newLast7Days: newUsersLast7d,
                    newLast30Days: newUsersLast30d
                },
                content: {
                    blueprints: totalBlueprints,
                    wins: totalWins,
                    sideQuests: totalSideQuests,
                    sectors: totalSectors,
                    tasks: {
                        total: totalTasks,
                        completed: completedTasks,
                        active: totalTasks - completedTasks
                    },
                    moods: totalMoods
                },
                storage: {
                    filesCount: uploadFilesCount,
                    totalSizeBytes: totalUploadSizeBytes,
                    totalSizeMB: parseFloat((totalUploadSizeBytes / (1024 * 1024)).toFixed(2))
                }
            }
        });
    } catch (err) {
        console.error('[Admin Analytics Error]:', err);
        res.status(500).json({ success: false, message: 'Server error retrieving analytics', error: err.message });
    }
});

// @desc    Get List of Users with individual data counters
// @route   GET /api/admin/users?search=...
// @access  Admin
router.get('/users', adminProtect, async (req, res) => {
    try {
        const { search } = req.query;
        let query = {};

        if (search && typeof search === 'string' && search.trim() !== '') {
            const clean = search.trim();
            const regex = new RegExp(clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            query = {
                $or: [
                    { email: regex },
                    { displayName: regex },
                    { firebaseUid: regex }
                ]
            };
        }

        const users = await User.find(query)
            .sort({ createdAt: -1 })
            .lean();

        // Enrich users with counts of their data entities
        const uids = users.map(u => u.firebaseUid).filter(Boolean);

        const [
            blueprintsByUser,
            winsByUser,
            sideQuestsByUser,
            sectorsByUser,
            tasksByUser,
            moodsByUser
        ] = await Promise.all([
            Blueprint.aggregate([
                { $match: { firebaseUid: { $in: uids } } },
                { $group: { _id: '$firebaseUid', count: { $sum: 1 } } }
            ]),
            Win.aggregate([
                { $match: { firebaseUid: { $in: uids } } },
                { $group: { _id: '$firebaseUid', count: { $sum: 1 } } }
            ]),
            SideQuest.aggregate([
                { $match: { firebaseUid: { $in: uids } } },
                { $group: { _id: '$firebaseUid', count: { $sum: 1 } } }
            ]),
            Sector.aggregate([
                { $match: { firebaseUid: { $in: uids } } },
                { $group: { _id: '$firebaseUid', count: { $sum: 1 } } }
            ]),
            Task.aggregate([
                { $match: { firebaseUid: { $in: uids } } },
                { $group: { _id: '$firebaseUid', count: { $sum: 1 } } }
            ]),
            Mood.aggregate([
                { $match: { firebaseUid: { $in: uids } } },
                { $group: { _id: '$firebaseUid', count: { $sum: 1 } } }
            ])
        ]);

        const toMap = (list) => {
            const m = {};
            list.forEach(item => { m[item._id] = item.count; });
            return m;
        };

        const bpMap = toMap(blueprintsByUser);
        const winMap = toMap(winsByUser);
        const sqMap = toMap(sideQuestsByUser);
        const secMap = toMap(sectorsByUser);
        const taskMap = toMap(tasksByUser);
        const moodMap = toMap(moodsByUser);

        const enrichedUsers = users.map(u => ({
            _id: u._id,
            firebaseUid: u.firebaseUid,
            displayName: u.displayName || 'Delulu Dreamer',
            email: u.email || null,
            photoURL: u.photoURL || null,
            createdAt: u.createdAt,
            achievementsCount: Array.isArray(u.achievements) ? u.achievements.length : 0,
            stats: u.stats || {},
            counts: {
                blueprints: bpMap[u.firebaseUid] || 0,
                wins: winMap[u.firebaseUid] || 0,
                sideQuests: sqMap[u.firebaseUid] || 0,
                sectors: secMap[u.firebaseUid] || 0,
                tasks: taskMap[u.firebaseUid] || 0,
                moods: moodMap[u.firebaseUid] || 0
            }
        }));

        res.json({ success: true, count: enrichedUsers.length, users: enrichedUsers });
    } catch (err) {
        console.error('[Admin Users List Error]:', err);
        res.status(500).json({ success: false, message: 'Server error retrieving users', error: err.message });
    }
});

// @desc    Surgically and permanently delete a user and all their app interactions
// @route   DELETE /api/admin/users/:uid
// @access  Admin
router.delete('/users/:uid', adminProtect, async (req, res) => {
    try {
        const { uid } = req.params;
        if (!uid || typeof uid !== 'string' || uid.trim() === '') {
            return res.status(400).json({ success: false, message: 'Valid user identifier is required' });
        }

        const trimmedId = uid.trim();

        // Safe query: NEVER allow empty object in query
        let userQuery;
        if (mongoose.isValidObjectId(trimmedId)) {
            userQuery = { $or: [{ firebaseUid: trimmedId }, { _id: new mongoose.Types.ObjectId(trimmedId) }] };
        } else {
            userQuery = { firebaseUid: trimmedId };
        }

        const user = await User.findOne(userQuery);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const targetFirebaseUid = user.firebaseUid;
        if (!targetFirebaseUid || typeof targetFirebaseUid !== 'string' || targetFirebaseUid.trim() === '') {
            return res.status(400).json({ success: false, message: 'Target user lacks valid firebaseUid' });
        }

        console.log(`[Admin Deletion] Starting complete purge for user: ${user.email || user.displayName} (${targetFirebaseUid})`);

        // 1. Gather and delete all uploaded pictures for this user's blueprints
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        let unlinkedPhotosCount = 0;

        try {
            const userBlueprints = await Blueprint.find({ firebaseUid: targetFirebaseUid });
            const filesToDelete = new Set();

            userBlueprints.forEach(bp => {
                // Evidence files from quests
                if (Array.isArray(bp.quests)) {
                    bp.quests.forEach(q => {
                        if (q.evidenceUrl && typeof q.evidenceUrl === 'string') {
                            const filename = path.basename(q.evidenceUrl.trim());
                            if (filename) filesToDelete.add(filename);
                        }
                    });
                }

                // Vision board uploaded images
                if (Array.isArray(bp.visionBoard)) {
                    bp.visionBoard.forEach(item => {
                        if (item.type === 'image' && item.content && typeof item.content === 'string') {
                            const filename = path.basename(item.content.trim());
                            if (filename) filesToDelete.add(filename);
                        }
                    });
                }
            });

            // Delete physical files
            filesToDelete.forEach(filename => {
                try {
                    const filePath = path.join(uploadsDir, filename);
                    // Ensure filePath is strictly inside uploads directory (prevent path traversal)
                    const resolved = path.resolve(filePath);
                    if (resolved.startsWith(path.resolve(uploadsDir)) && fs.existsSync(resolved)) {
                        fs.unlinkSync(resolved);
                        unlinkedPhotosCount++;
                        console.log(`[Admin Deletion] Unlinked file: ${filename}`);
                    }
                } catch (fileErr) {
                    console.warn(`[Admin Deletion] Could not unlink file ${filename}:`, fileErr.message);
                }
            });
        } catch (filesErr) {
            console.warn('[Admin Deletion] Photo cleanup warning:', filesErr.message);
        }

        // 2. Delete all MongoDB collections strictly isolated by targetFirebaseUid
        const [
            blueprintsResult,
            winsResult,
            moodsResult,
            tasksResult,
            sectorsResult,
            sideQuestsResult,
            userDeleteResult
        ] = await Promise.all([
            Blueprint.deleteMany({ firebaseUid: targetFirebaseUid }),
            Win.deleteMany({ firebaseUid: targetFirebaseUid }),
            Mood.deleteMany({ firebaseUid: targetFirebaseUid }),
            Task.deleteMany({ firebaseUid: targetFirebaseUid }),
            Sector.deleteMany({ firebaseUid: targetFirebaseUid }),
            SideQuest.deleteMany({ firebaseUid: targetFirebaseUid }),
            User.deleteOne({ _id: user._id })
        ]);

        // 3. Delete Firebase Auth account
        let firebaseAuthDeleted = false;
        let firebaseAuthNote = null;

        if (admin.apps && admin.apps.length > 0) {
            try {
                await admin.auth().deleteUser(targetFirebaseUid);
                firebaseAuthDeleted = true;
                console.log(`[Admin Deletion] Deleted user from Firebase Auth: ${targetFirebaseUid}`);
            } catch (fbErr) {
                if (fbErr.code === 'auth/user-not-found') {
                    firebaseAuthDeleted = true;
                    firebaseAuthNote = 'User record did not exist in Firebase Auth (already removed or local user)';
                } else {
                    console.warn(`[Admin Deletion] Firebase Auth deleteUser warning (${targetFirebaseUid}):`, fbErr.message);
                    firebaseAuthNote = fbErr.message;
                }
            }
        } else {
            firebaseAuthNote = 'Firebase Admin was not initialized; skipped Firebase Auth deletion';
        }

        const summary = {
            blueprints: blueprintsResult.deletedCount,
            wins: winsResult.deletedCount,
            moods: moodsResult.deletedCount,
            tasks: tasksResult.deletedCount,
            sectors: sectorsResult.deletedCount,
            sideQuests: sideQuestsResult.deletedCount,
            uploadedFiles: unlinkedPhotosCount,
            userProfile: userDeleteResult.deletedCount,
            firebaseAuth: firebaseAuthDeleted
        };

        console.log(`[Admin Deletion] Completed successfully for ${targetFirebaseUid}:`, summary);

        res.json({
            success: true,
            message: `Account and all associated interactions for "${user.displayName || user.email || targetFirebaseUid}" permanently deleted.`,
            user: {
                displayName: user.displayName,
                email: user.email,
                firebaseUid: targetFirebaseUid
            },
            purged: summary,
            firebaseAuthNote
        });

    } catch (err) {
        console.error('[Admin Deletion Error]:', err);
        res.status(500).json({
            success: false,
            message: 'Server error while executing account deletion',
            error: err.message
        });
    }
});

module.exports = router;
