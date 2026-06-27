# CubingIndia Dashboard — Deployment Guide

## Quick Deploy to Render (Free, 5 minutes)

### 1. Push to GitHub
```bash
cd CubingIndia
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/cubingindia-dashboard.git
git push -u origin main
```

### 2. Deploy on Render
1. Go to [render.com](https://render.com) → Sign up/Login
2. Click **New** → **Web Service**
3. Connect your GitHub repo
4. Settings:
   - **Name:** cubingindia-dashboard
   - **Runtime:** Python
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app`
   - **Plan:** Free
5. Add Environment Variables:
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_KEY` = your Supabase anon key
   - `FLASK_SECRET` = any random string
6. Click **Create Web Service**

### 3. Access Your App
- URL: `https://cubingindia-dashboard.onrender.com`
- First visit: `/setup` to create admin account
- Login: `/login`

### 4. Install as PWA on Phone
1. Open the URL in Chrome/Safari
2. Tap **"Add to Home Screen"**
3. App icon appears on home screen
4. Opens like a native app

---

## Alternative: Hostinger VPS ($6/mo)

```bash
# SSH into VPS
ssh root@YOUR_VPS_IP

# Install Python
apt update && apt install python3 python3-pip nginx -y

# Upload files
scp -r CubingIndia/ root@YOUR_VPS_IP:/opt/cubingindia/

# Install dependencies
cd /opt/cubingindia
pip3 install -r requirements.txt

# Create systemd service
cat > /etc/systemd/system/cubingindia.service << EOF
[Unit]
Description=CubingIndia Dashboard
After=network.target

[Service]
User=root
WorkingDirectory=/opt/cubingindia
ExecStart=/usr/local/bin/gunicorn app:app -b 0.0.0.0:5050
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Start service
systemctl enable cubingindia
systemctl start cubingindia

# Nginx reverse proxy
cat > /etc/nginx/sites-available/cubingindia << EOF
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:5050;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

ln -s /etc/nginx/sites-available/cubingindia /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

# SSL with Certbot
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Your Supabase project URL (e.g. `https://xxx.supabase.co`) |
| `SUPABASE_KEY` | Your Supabase anon/public key |
| `FLASK_SECRET` | Random string for session encryption |
