#!/bin/bash

# Script to run both the portfolio and RMP components

echo "Starting Database Security Portfolio and RMP Components..."
echo ""

# Start RMP API server in background
echo "Starting RMP API server on port 3001..."
cd rmp
npm run api-server &
RMP_PID=$!
cd ..

# Wait a moment for RMP server to start
sleep 3

# Start Flask portfolio
echo "Starting Flask portfolio on port 5000..."
python main.py &
FLASK_PID=$!

echo ""
echo "Both services are running:"
echo "- Portfolio: http://localhost:5000"
echo "- RMP API: http://localhost:3001"
echo "- RMP UI: http://localhost:5000/rmp/scripts/rmp_ui.html"
echo ""
echo "Press Ctrl+C to stop both services"

# Wait for user to stop
trap "echo 'Stopping services...'; kill $RMP_PID $FLASK_PID; exit" INT
wait