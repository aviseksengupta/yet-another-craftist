#!/bin/bash
# Installation and setup script for Craft-Todoist sync system

set -e

echo "======================================"
echo "Craft.do ↔ Todoist Sync System Setup"
echo "======================================"
echo ""

# Check Python version
echo "Checking Python version..."
python3 --version || {
    echo "Error: Python 3 is not installed"
    exit 1
}

# Install dependencies
echo ""
echo "Installing Python dependencies..."
pip3 install -r requirements.txt

# Run setup
echo ""
echo "Running configuration setup..."
python3 setup.py

# Run tests
echo ""
echo "Running tests..."
python3 test_system.py

echo ""
echo "======================================"
echo "Setup complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Run a test sync:     python3 main.py once"
echo "2. Check status:        python3 main.py status"
echo "3. Start continuous:    python3 main.py continuous"
echo ""
echo "Or use make commands:"
echo "  make sync-once"
echo "  make status"
echo "  make sync"
echo ""
