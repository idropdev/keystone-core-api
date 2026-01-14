#!/bin/bash
# Keystone Core API - Startup Script
# This script helps you start the API with all required services

set -e

echo "🚀 Keystone Core API Startup Script"
echo "===================================="
echo ""

# Check Node.js version
echo "📦 Checking Node.js version..."
NODE_VERSION=$(node --version)
echo "   Current: $NODE_VERSION"
REQUIRED_VERSION=$(cat .nvmrc)
echo "   Required: v$REQUIRED_VERSION"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo "   Creating from env-example-relational..."
    cp env-example-relational .env
    echo "   ✅ Created .env file"
    echo "   ⚠️  Please edit .env and set DATABASE_HOST=localhost if running locally"
    echo ""
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "   ✅ Dependencies installed"
    echo ""
fi

# Check Docker
echo "🐳 Checking Docker services..."
if ! command -v docker &> /dev/null; then
    echo "   ⚠️  Docker not found. You'll need to install Docker or use a local database."
else
    # Check if services are running
    if docker compose ps | grep -q "postgres.*Up"; then
        echo "   ✅ PostgreSQL is running"
    else
        echo "   ⚠️  PostgreSQL not running. Starting Docker services..."
        docker compose up -d postgres adminer maildev
        echo "   ✅ Docker services started"
        echo "   ⏳ Waiting for PostgreSQL to be ready..."
        sleep 5
    fi
fi
echo ""

# Run migrations
echo "🗄️  Running database migrations..."
npm run migration:run
echo "   ✅ Migrations completed"
echo ""

# Optional: Run seeds (uncomment if needed)
# echo "🌱 Running database seeds..."
# npm run seed:run:relational
# echo "   ✅ Seeds completed"
# echo ""

# Start the server
echo "🚀 Starting development server..."
echo "   Server will be available at: http://localhost:3000"
echo "   Swagger docs will be at: http://localhost:3000/docs"
echo ""
npm run start:dev










