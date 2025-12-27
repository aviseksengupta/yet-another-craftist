# Quick Reference Guide

## Installation (One-time)

```bash
pip install -r requirements.txt
python setup.py
```

## Testing

```bash
python test_system.py
```

## Running

### Single Sync
```bash
python main.py once
```

### Continuous Sync
```bash
python main.py continuous
```

### Check Status
```bash
python main.py status
```

## Using Make Commands

```bash
make install    # Install dependencies
make setup      # Configure
make test       # Run tests
make sync-once  # Single sync
make sync       # Continuous
make status     # Show status
make clean      # Clean database/logs
```

## File Locations

- **Config**: `.env`
- **Database**: `sync_data.db`
- **Logs**: `sync.log`

## Common Tasks

### View Logs
```bash
tail -f sync.log
```

### Check Database
```bash
sqlite3 sync_data.db "SELECT * FROM tasks LIMIT 5;"
```

### Stop Running Sync
Press `Ctrl+C` in the terminal

### Reset Everything
```bash
make clean
python setup.py
python main.py once
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Token not found" | Check `.env` file exists and has correct tokens |
| Connection failed | Verify API tokens are valid |
| Tasks not syncing | Run `python main.py status` and check logs |
| Conflicts | Check `sync_log` table in database |

## Key Concepts

**Sync Flow**:
1. Fetch from both platforms
2. Match existing tasks
3. Determine operations
4. Execute sync
5. Update database

**Project Mapping**:
- Todoist leaf projects → Craft documents
- Parent projects → Craft folders
- Tasks in unmapped docs → Todoist inbox

**Conflict Resolution**:
- Both sides modified within 3s → Conflict
- Most recent change wins
- Logged for review

## API Limits

**Todoist**: Rate limits apply (500 requests/min)
**Craft**: Check Craft.do API documentation

## Support

1. Check [USAGE.md](USAGE.md) for details
2. Review [README.md](README.md) for setup
3. Check logs: `sync.log`
4. Check status: `python main.py status`
