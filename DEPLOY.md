# Delulu Server Deployment Guide

This guide is tailored for your **Vultr VPS** where Node.js, Docker/MongoDB, and PM2 are **already installed**.

## 1. Project Setup

### 1.1 Clone & Install
SSH into your server:
```bash
ssh root@<your_vultr_ip>
```

Navigate to your workspace (e.g., `/var/www/` or `~/`) and clone:
```bash
# Verify you are not overwriting previous projects
cd /var/www
git clone <your-repo-url> delulu-server
cd delulu-server
```

Install dependencies:
```bash
npm install
```

## 2. Environment Configuration

### 2.1 Create .env
Crucial step. `delulu-server` relies heavily on API keys and Firebase credentials.

```bash
nano .env
```

### 2.2 Paste Variables
Copy the content of your **local** `delulu-server/.env` file.
> **Note**: Ensure `FIREBASE_SERVICE_ACCOUNT` is pasted as a **single line** string if possible, or verify that your `dotenv` parser handles newlines correctly.

Template:
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/delulu
GEMINI_API_KEY=AIzaSy...
FIREBASE_SERVICE_ACCOUNT={"type": "service_account", ...}
REVENUECAT_API_KEY=test_...
CEREBRAS_API_KEY=csk-...
```

> **⚠️ PORT CONFLICT WARNING**: If `qnai` is still running on port `5000`, change `PORT` here to `5001` and update your Nginx config accordingly.

## 3. Database (MongoDB)

Since MongoDB is already running (Docker), just ensure the database `delulu` exists or is accessible. Mongoose will create it automatically upon the first write.

Verify MongoDB is up:
```bash
docker ps | grep mongo
```

## 4. Run with PM2

Start the server process:

```bash
# If running on Port 5000
pm2 start server.js --name "delulu-api"

# IF you changed port to 5001 in .env
# pm2 start server.js --name "delulu-api" -- --port 5001
```

Save the process list so it restarts on reboot:
```bash
pm2 save
```

## 5. Nginx & SSL (Expose to World)

### 5.1 Create Config
```bash
nano /etc/nginx/sites-available/delulu
```

### 5.2 Nginx Block
Replace `your-domain.com` and ensure the `proxy_pass` port matches your `.env`.

```nginx
server {
    server_name api.delulu.your-domain.com; # Subdomain recommended

    location / {
        proxy_pass http://localhost:5000; # CHANGE TO 5001 if needed
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 5.3 Enable & Restart
```bash
ln -s /etc/nginx/sites-available/delulu /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### 5.4 SSL (Certbot)
```bash
certbot --nginx -d api.delulu.your-domain.com
```

## 6. Verification
Check the logs to ensure it connected to MongoDB and Firebase:
```bash
pm2 logs delulu-api
```
Look for:
- `MongoDB Connected`
- `Server running on port ...`
