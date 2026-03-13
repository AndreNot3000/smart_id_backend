#!/bin/bash

# Script to fix the corrupted CORS_ORIGIN on VPS

echo "🔧 Fixing VPS .env file..."

# Backup current .env
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ Backup created"

# Fix the CORS_ORIGIN line
sed -i 's|CORS_ORIGIN=.*|CORS_ORIGIN=https://smartunivid.xyz,https://www.smartunivid.xyz,https://unismart-delta.vercel.app|g' .env

echo "✅ CORS_ORIGIN fixed"
echo ""
echo "📋 Current CORS_ORIGIN:"
grep "CORS_ORIGIN" .env
echo ""
echo "🔄 Restarting backend..."
pm2 restart campus-id-backend

echo ""
echo "✅ Done! Backend restarted with correct CORS configuration"
echo ""
echo "📊 Backend status:"
pm2 status campus-id-backend
