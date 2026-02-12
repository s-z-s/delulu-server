# 🌌 Delulu Server

The official backend for **delulu**, the manifestation app that turns your "delusions" into reality. This server handles AI blueprint generation, user progress tracking, and secure data management.

## 🚀 Tech Stack

- **Runtime**: Node.js (Express.js)
- **Database**: MongoDB Atlas (Mongoose)
- **Authentication**: Firebase Admin SDK
- **AI Integration**: 
  - Google Gemini API
  - Cerebras Cloud SDK (High-speed Llama-3 inference)
- **Infrastructure**: hosted on Vercel/DigitalOcean (configurable)
- **Payments**: RevenueCat Webhooks Integration

## 📁 Architecture

```text
├── config/             # Database & environment configurations
├── models/             # Mongoose schemas (User, Blueprint, Win, Todo)
├── routes/             # API endpoints (Auth, Blueprint, Wins, etc.)
├── services/           # Business logic & AI orchestration
├── public/             # Static assets (Terms, Privacy Policy)
└── server.js           # Entry point
```

## 🏗️ High-Level Architecture

The server acts as the **Orchestrator** between the mobile client and the AI models:

1.  **Request Layer**: Receives Dream inputs and Win logs from the Flutter app.
2.  **Auth Layer**: Validates sessions using Firebase Admin SDK.
3.  **AI Service**: 
    - **Step 1**: Sends raw dreams to **Cerebras (Llama-3)** for rapid brainstorming.
    - **Step 2**: Refines structure using **Google Gemini** for JSON-schema validation.
4.  **Data Persistence**: Stores the complex, nested Blueprint structures in **MongoDB Atlas**.
    - **Sectors**: Manages the "Wheel of Life" categories (Health, Wealth, etc.).
    - **Side Quests**: Tracks daily reoccurring habits.
5.  **Static Hosting**: Serves the Privacy and Terms pages directly via Express static middleware.

## 🛠️ Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB Atlas connection string
- Firebase Service Account key (`service-account.json`)
- API Keys for Google Gemini and Cerebras

### Installation

1. Clone the repository and navigate to the server folder:
   ```bash
   npm install
   ```

2. Create a `.env` file:
   ```env
   PORT=5000
   MONGO_URI=your_mongodb_uri
   FIREBASE_PROJECT_ID=your_id
   GEMINI_API_KEY=your_key
   CEREBRAS_API_KEY=your_key
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

## 📡 API Overview

### 🔐 Authentication
- `POST /api/auth/login` - Validates Firebase token and syncs user profile.

### 🗺️ Journey & Blueprints
- `POST /api/blueprint/generate` - AI pipeline for new journey creation.
- `GET /api/blueprint` - Fetch all saved journeys.
- `PATCH /api/blueprint/:id/quest` - Mark specific quest as complete.

### 🎡 Wheel of Life (Sectors)
- `GET /api/todos/sectors` - Get analysis of life balance.
- `PATCH /api/todos/sectors/:id/task` - Complete a specific task within a level.

### 🎈 Side Quests & Wins
- `POST /api/side-quests` - Create a reoccurring habit.
- `POST /api/wins` - Log a "Little Win" for the main character streak.

### 🎨 Themes & Customization
- `GET /api/theme` - Get user's current theme settings.
- `POST /api/theme/sync` - Persist local theme preferences to account.

### 📄 Static Pages
- `GET /terms` - Terms of Service.
- `GET /privacy-policy` - Privacy Policy.
- `GET /delete-account` - Account deletion request page.

## ⚖️ License
ISC License. See `LICENSE` for details.

