# Craft.do ↔ Todoist Sync System

A robust bidirectional synchronization system between Craft.do and Todoist for seamless task management across both platforms.

**Built with TypeScript** for type safety and modern JavaScript features.

## ✨ Features

- **🔄 Two-way sync**: Tasks created or updated in either Craft or Todoist are automatically synced to the other
- **📁 Project hierarchy**: Todoist projects intelligently map to Craft folders and documents
- **⏱️ Timestamp-based conflict resolution**: Recent changes take precedence with configurable conflict detection
- **✅ Completion sync**: Marking tasks complete on either side syncs to the other
- **🕐 Automatic scheduling**: Runs sync every 5-10 minutes (configurable)
- **📊 Database tracking**: SQLite database maintains sync state and mappings
- **📝 Comprehensive logging**: All operations logged for debugging and audit

## 🏗️ Architecture

The system consists of well-separated, testable modules:

```
┌─────────────────────────────────────────────────────────────┐
│                      Main Sync Runner                        │
│                      (main.py)                               │
└────────────┬────────────────────────────────────┬───────────┘
             │                                     │
    ┌────────▼────────┐                  ┌────────▼────────┐
    │  Sync Engine    │                  │    Database     │
    │ (sync_engine.py)│◄─────────────────┤  (database.py)  │
    └────┬───────┬────┘                  └─────────────────┘
         │       │
    ┌────▼───┐ ┌▼────────┐
    │Todoist │ │  Craft  │
    │ Module │ │ Module  │
    └────┬───┘ └───┬─────┘
         │         │
    ┌────▼───┐ ┌──▼──────┐
    │Todoist │ │ Craft   │
    │  API   │ │  API    │
    └────────┘ └─────────┘
```

### Core Modules

1. **Todoist Integration** ([src/todoist.ts](src/todoist.ts)): Complete Todoist API client
   - Fetches projects and task hierarchies
   - Creates, updates, and completes tasks
   - Uses official Todoist TypeScript SDK

2. **Craft Integration** ([src/craft.ts](src/craft.ts)): Craft.do API client
   - Manages tasks across inbox, active, upcoming, and logbook scopes
   - Searches daily notes for embedded tasks
   - Handles block-based document structure

3. **Sync Engine** ([src/syncEngine.ts](src/syncEngine.ts)): Core synchronization logic
   - Orchestrates bidirectional sync
   - Matches tasks using database mappings
   - Implements conflict resolution
   - Executes sync operations atomically

4. **Task Model** ([src/models.ts](src/models.ts)): Unified task representation
   - Common model for both platforms
   - Conversion to/from Todoist and Craft formats
   - Sync status tracking
   - Type-safe interfaces

5. **Database** ([src/database.ts](src/database.ts)): SQLite persistence layer
   - Task and project mappings
   - Sync operation logs
   - Conflict tracking
   - Uses better-sqlite3 for performance

## 🚀 Quick Start

### 1. Install Dependencies
npm install
```

### 2. Configure API Credentials

Create a `.env` file:

```bash
cp .env.example .env
# Edit .env and add your API credentials
```

Get your credentials:
- **Todoist token**: [Todoist Settings → Integrations](https://todoist.com/prefs/integrations)
- **Craft API URL**: From your Craft.do API link (format: `https://connect.craft.do/links/YOUR_ID/api/v1`)

### 3. Build the Project

```bash
npm run build
```

### 4. Test the Setup

```bash
npm test
```

This verifies:
- ✓ Database operations
- ✓ Task model conversions
- ✓ Todoist API connection
- ✓ Craft API connection

### 5. Run Sync

**Single sync (test):**
```bash
npm run sync:once
```

**Continuous sync (production):**
```bash
npm run sync:continuous
```

**Check status:**
```bash
npm run sync:**
```bash
python main.py status
```

See [USAGE.md](USAGE.md) for detailed usage instructions.

## Database Schema

The system uses SQLite to track task mappings and sync state:

- **tasks**: Stores task data and sync status
- **task_mappings**: Links Todoist and Craft task IDs
- **projects**: Stores project/folder hierarchy
- **sync_log**: Tracks sync operations for debugging

## Sync Behavior

### Task Creation
- New task in Todoist → Creates task in corresponding Craft document
- New task in Craft document (linked to project) → Creates in Todoist project
- New task in Craft document (not linked to project) → Creates in Todoist Inbox

### Task Updates
- Content, due date, labels, completion status all sync bidirectionally
- Timestamp comparison determines which version is newer

### Project Mapping
- Todoist leaf projects → Craft documents
- Todoist parent projects → Craft folders
- Parent projects with tasks → Folder + document with same name

## Conflict Resolution

If both sides are modified within 3 seconds, the system logs a warning but applies the most recent change based on timestamps.

## Limitations

- Does not sync task assignments
- Archived items in Todoist are ignored
- Only syncs top-level task properties (no subtasks yet)
