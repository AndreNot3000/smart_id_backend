# Deployment Guide

## Production Setup (VPS)

### Server Details
- **IP**: 64.111.93.87
- **Domain**: smartunivid.xyz
- **API Domain**: api.smartunivid.xyz
- **Backend Port**: 8000

### Deployment Steps

1. **SSH into VPS**
```bash
ssh root@64.111.93.87
cd ~/smart_id_backend
```

2. **Pull Latest Changes**
```bash
git pull origin main
```

3. **Install Dependencies**
```bash
bun install
```

4. **Restart Backend**
```bash
pm2 restart campus-id-backend
pm2 logs campus-id-backend --lines 20
```

### PM2 Commands
```bash
pm2 status                    # Check status
pm2 logs campus-id-backend    # View logs
pm2 restart campus-id-backend # Restart
pm2 stop campus-id-backend    # Stop
pm2 start main.ts --name campus-id-backend --interpreter bun  # Start
```

### Nginx Configuration
Location: `/etc/nginx/sites-available/mybackend.conf`

```bash
sudo nginx -t              # Test config
sudo systemctl reload nginx # Reload
```

### SSL Certificate
```bash
sudo certbot --nginx -d smartunivid.xyz -d api.smartunivid.xyz
```

### Environment Variables
Update `.env` on server (never commit to git):
```bash
nano .env
```

## Development Testing (Ngrok)

### Setup
1. Install Ngrok from Microsoft Store
2. Get auth token from https://dashboard.ngrok.com
3. Configure: `ngrok config add-authtoken YOUR_TOKEN`

### Usage
```bash
# Terminal 1: Start backend
bun main.ts

# Terminal 2: Start Ngrok
ngrok http 8000
```

Use the Ngrok URL for mobile testing.

## Troubleshooting

### Backend not responding
```bash
pm2 logs campus-id-backend --lines 50
```

### Port already in use
```bash
sudo lsof -i :8000
kill -9 PID
```

### Database connection issues
Check MongoDB Atlas connection string in `.env`
