# Usage Guide

## Quick Start

### 1. Installation

```bash
# Clone or navigate to the project directory
cd yet-another-craftist

# Install dependencies
pip install -r requirements.txt
```

### 2. Configuration

#### Option A: Interactive Setup (Recommended)
```bash
python setup.py
```

#### Option B: Manual Configuration
1. Copy `.env.example` to `.env`
2. Edit `.env` and add your API credentials:
   - Get Todoist token from: https://todoist.com/prefs/integrations
   - Get Craft API URL from your Craft.do API link

### 3. Test the Setup

```bash
python test_system.py
```

This will verify:
- Database operations work
- Task models convert correctly
- Todoist API connection is successful
- Craft API connection is successful

### 4. Run Sync

#### Single Sync (Test)
```bash
python main.py once
```

#### Continuous Sync (Production)
```bash
python main.py continuous
```

This will sync every 5-10 minutes (configurable in `.env`).

#### Check Status
```bash
python main.py status
```

## Commands Reference

### `python main.py once`
Runs a single sync cycle and exits. Perfect for:
- Testing the sync system
- Manual syncs
- Cron jobs

### `python main.py continuous`
Runs continuous sync with scheduled intervals. The sync will:
- Run immediately on start
- Wait for the configured interval (default: 5 minutes)
- Run again automatically
- Continue until stopped with Ctrl+C

### `python main.py status`
Displays current sync statistics:
- Total tasks
- Active vs completed tasks
- Sync status (synced, pending, conflicts, errors)
- Recent sync operations log

## How It Works

### Sync Flow

1. **Fetch Data**
   - Retrieves all tasks from Todoist (including completed)
   - Retrieves all tasks from Craft (inbox, active, upcoming, logbook)
   - Retrieves project hierarchy from Todoist

2. **Match Tasks**
   - Matches tasks between systems using database mappings
   - Identifies new tasks on each side
   - Identifies tasks that need updates

3. **Determine Operations**
   - New tasks → Create on other side
   - Updated tasks → Update on other side
   - Completed tasks → Mark complete on other side
   - Conflicts → Log warning and sync most recent

4. **Execute Sync**
   - Creates new tasks
   - Updates existing tasks
   - Marks completions
   - Logs all operations

### Project/Folder Mapping

**Todoist → Craft:**
- Leaf project (no children) → Craft document
- Parent project (with children) → Craft folder
- Parent project with tasks → Folder + document with same name

**Craft → Todoist:**
- Tasks in mapped documents → Go to corresponding project
- Tasks in unmapped documents → Go to Todoist Inbox
- Projects are NOT auto-created in Todoist

### Conflict Resolution

If both sides are modified within 3 seconds (configurable):
- System logs a warning
- Most recent change wins (based on timestamp)
- Task is marked with "conflict" status for review

## Monitoring

### Log Files

All sync operations are logged to:
- `sync.log` - Detailed sync operations
- Console output - Real-time progress

### Database

Sync state is stored in SQLite database:
- `sync_data.db` (default location)

You can inspect it with:
```bash
sqlite3 sync_data.db
.tables
SELECT * FROM tasks LIMIT 5;
SELECT * FROM sync_log ORDER BY timestamp DESC LIMIT 10;
```

## Troubleshooting

### "TODOIST_TOKEN not found"
- Make sure you have a `.env` file in the project directory
- Check that `TODOIST_TOKEN=` line has your actual token

### "CRAFT_API_BASE_URL not found"
- Make sure your Craft API URL is in `.env`
- Format should be: `https://connect.craft.do/links/YOUR_ID/api/v1`

### "Request failed with status code 401"
- Your API token is invalid or expired
- Generate a new token and update `.env`

### Tasks not syncing
1. Run `python main.py status` to check sync status
2. Check `sync.log` for error messages
3. Look for tasks with "conflict" or "error" status
4. Verify tasks exist in both systems

### Conflicts
- Tasks with recent modifications on both sides (within 3s)
- System will sync the most recent change
- Check database: `SELECT * FROM tasks WHERE sync_status = 'conflict'`

## Advanced Configuration

### Environment Variables

All settings are in `.env`:

```bash
# Required
TODOIST_TOKEN=your_token_here
CRAFT_API_BASE_URL=your_craft_url_here

# Optional
DATABASE_PATH=./sync_data.db           # Database location
SYNC_INTERVAL=300                       # Sync every 5 minutes
CONFLICT_WINDOW=3                       # 3-second conflict window
```

### Running as a Service

#### Using systemd (Linux)

Create `/etc/systemd/system/craft-todoist-sync.service`:

```ini
[Unit]
Description=Craft-Todoist Sync Service
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/path/to/yet-another-craftist
ExecStart=/usr/bin/python3 /path/to/yet-another-craftist/main.py continuous
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable craft-todoist-sync
sudo systemctl start craft-todoist-sync
sudo systemctl status craft-todoist-sync
```

#### Using launchd (macOS)

Create `~/Library/LaunchAgents/com.craftist.sync.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.craftist.sync</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/python3</string>
        <string>/path/to/yet-another-craftist/main.py</string>
        <string>continuous</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/yet-another-craftist</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Then:
```bash
launchctl load ~/Library/LaunchAgents/com.craftist.sync.plist
launchctl start com.craftist.sync
```

## Support

For issues or questions:
1. Check the logs: `tail -f sync.log`
2. Run tests: `python test_system.py`
3. Check sync status: `python main.py status`
4. Review the database for task sync states

## Development

### Project Structure

```
yet-another-craftist/
├── main.py                  # Main entry point
├── config.py                # Configuration management
├── database.py              # Database operations
├── models.py                # Task model definition
├── todoist_integration.py   # Todoist API client
├── craft_integration.py     # Craft API client
├── sync_engine.py           # Sync orchestration logic
├── setup.py                 # Interactive setup script
├── test_system.py           # Test suite
├── requirements.txt         # Python dependencies
├── .env                     # Configuration (not in git)
└── sync_data.db            # SQLite database (not in git)
```

### Testing Individual Components

```bash
# Test database
python database.py

# Test models
python -c "from models import Task; print(Task('Test Task'))"

# Test Todoist integration
python todoist_integration.py

# Test Craft integration
python craft_integration.py

# Test full sync engine
python sync_engine.py
```
