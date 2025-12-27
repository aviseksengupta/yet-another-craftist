# Craft.do ↔ Todoist Sync - TypeScript Implementation

Complete bidirectional sync system built with TypeScript.

## 📦 Installation

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your API tokens

# 3. Build the project
npm run build

# 4. Test the setup
npm test

# 5. Run your first sync
npm run sync:once
```

## 🔧 Available Commands

```bash
# Development
npm run dev              # Run with ts-node (no build needed)
npm run build            # Compile TypeScript to JavaScript
npm test                 # Run test suite

# Sync Operations
npm run sync:once        # Single sync cycle
npm run sync:continuous  # Continuous sync (runs every 5-10 min)
npm run sync:status      # Show current sync status

# Utility
npm run clean            # Remove build artifacts and database
```

## 📁 Project Structure

```
src/
├── index.ts        # Main entry point and CLI
├── types.ts        # TypeScript type definitions
├── models.ts       # Task model with conversion logic
├── database.ts     # SQLite database layer
├── todoist.ts      # Todoist API integration
├── craft.ts        # Craft.do API integration
├── syncEngine.ts   # Sync orchestration logic
├── config.ts       # Configuration management
└── test.ts         # Test suite
```

## 🔑 Environment Variables

Create a `.env` file with:

```env
TODOIST_TOKEN=your_token_here
CRAFT_API_BASE_URL=https://connect.craft.do/links/YOUR_ID/api/v1
DATABASE_PATH=./sync_data.db
SYNC_INTERVAL=300
CONFLICT_WINDOW=3
```

## ⚙️ Configuration

- `TODOIST_TOKEN`: Get from [Todoist Integrations](https://todoist.com/prefs/integrations)
- `CRAFT_API_BASE_URL`: From your Craft.do API link
- `DATABASE_PATH`: SQLite database location (default: `./sync_data.db`)
- `SYNC_INTERVAL`: Seconds between syncs (default: 300 = 5 minutes)
- `CONFLICT_WINDOW`: Conflict detection window in seconds (default: 3)

## 🚀 Usage

### Single Sync
Perfect for testing or manual syncs:
```bash
npm run sync:once
```

### Continuous Sync
Runs automatically every 5-10 minutes:
```bash
npm run sync:continuous
# Press Ctrl+C to stop
```

### Check Status
View sync statistics and recent operations:
```bash
npm run sync:status
```

## 🧪 Testing

Run the test suite to verify everything works:

```bash
npm test
```

Tests verify:
- ✅ Database operations
- ✅ Task model conversions
- ✅ Todoist API connectivity
- ✅ Craft API connectivity

## 📊 How It Works

### Sync Flow
1. **Fetch**: Retrieve all tasks from both Todoist and Craft
2. **Match**: Match tasks using database mappings
3. **Analyze**: Determine which tasks need syncing
4. **Execute**: Create/update/complete tasks on both sides
5. **Log**: Record all operations for debugging

### Conflict Resolution
- If both sides modified within 3 seconds: **Conflict detected**
- Resolution: **Most recent change wins**
- All conflicts logged for review

### Project Mapping
- **Todoist leaf projects** → Craft documents
- **Todoist parent projects** → Craft folders
- **Tasks in unmapped Craft docs** → Todoist Inbox

## 🛠️ Development

### TypeScript Features
- Full type safety with strict mode
- Async/await for clean async code
- Better-sqlite3 for fast database operations
- Official Todoist TypeScript SDK
- Axios for HTTP requests

### Adding New Features
1. Update types in `src/types.ts`
2. Implement logic in relevant module
3. Add tests in `src/test.ts`
4. Build and test: `npm run build && npm test`

## 📝 Database Schema

The SQLite database stores:
- **tasks**: Task data with sync metadata
- **projects**: Project/folder mappings
- **sync_log**: Operation audit trail

Query the database:
```bash
# View tasks
sqlite3 sync_data.db "SELECT * FROM tasks LIMIT 5;"

# View recent logs
sqlite3 sync_data.db "SELECT * FROM sync_log ORDER BY timestamp DESC LIMIT 10;"
```

## 🐛 Troubleshooting

### Build Errors
```bash
npm run clean
npm install
npm run build
```

### Connection Issues
1. Verify `.env` file exists and has correct tokens
2. Test individually:
   ```bash
   npm test
   ```
3. Check error logs in console

### Tasks Not Syncing
1. Check sync status: `npm run sync:status`
2. Look for conflicts or errors in the database
3. Run a manual sync: `npm run sync:once`

## 📦 Dependencies

### Production
- `@doist/todoist-api-typescript`: Official Todoist SDK
- `axios`: HTTP client for Craft API
- `better-sqlite3`: Fast SQLite3 bindings
- `dotenv`: Environment variable management
- `node-schedule`: Task scheduling

### Development
- `typescript`: TypeScript compiler
- `ts-node`: TypeScript execution
- `@types/*`: Type definitions

## 🔄 Migration from Python

If you previously had the Python version:

```bash
# Backup old database
cp sync_data.db sync_data.db.backup

# Remove Python files (already done)
# Install TypeScript version
npm install
npm run build

# The TypeScript version uses the same database schema!
npm run sync:once
```

## 📄 License

MIT

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## 📚 Further Reading

- [Todoist API Documentation](https://developer.todoist.com/rest/v2)
- [Craft.do API](document_instructions_to_agent.md)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
