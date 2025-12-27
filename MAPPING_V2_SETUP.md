# Doc-Project Mapper V2 Setup Guide

## Overview

The V2 mapper uses **manual configuration** instead of automatic name matching. You explicitly define which Todoist projects map to which Craft documents and folders.

## How It Works

### 3-Step Process

1. **Initialize**: Generate a template with all your Todoist projects and Craft folders
2. **Edit Manually**: Fill in the mappings in the JSON file
3. **Build**: Generate the final ID-based mapping configuration

### Resolution Logic

When syncing tasks:

**Todoist → Craft (where to create Craft tasks)**
- If task's Todoist project is mapped → use that Craft document
- Otherwise → fallback to "Task Inbox" document

**Craft → Todoist (where to create Todoist tasks)**  
- If task's Craft document is mapped → use that Todoist project
- Else if task's Craft folder is mapped → use that Todoist project
- Otherwise → fallback to "Inbox" project

## Setup Instructions

### Step 1: Initialize Configuration Template

```bash
npm run map:init
```

This creates `doc-project-mapping-manual.json` with:
- All your Todoist projects (set to `null`)
- All your Craft folders (set to `null`)  
- Empty `craftDocuments` object

### Step 2: Edit the Configuration

Open `doc-project-mapping-manual.json` and fill in mappings:

```json
{
  "todoistProjects": {
    "Vista Work": "Vista Work Tasks",
    "Projects": "Vista Work Tasks",
    "Guilds and Organisational": "Vista Work Tasks",
    "Placement Engine": "Placement Engine Tasks",
    "Professional": null,
    "Personal": "Personal Tasks",
    "...": "..."
  },
  "craftFolders": {
    "Vista Work": "Vista Work",
    "Vista Work > Projects": "Projects",
    "Personal": "Personal",
    "...": "..."
  },
  "craftDocuments": {}
}
```

**Mapping Rules:**
- `todoistProjects`: Maps Todoist project name → Craft document title
- `craftFolders`: Maps Craft folder path → Todoist project name
- Leave as `null` if you don't want to map that item
- `craftDocuments` is auto-populated during build (leave empty)

**Important Notes:**
- Document titles are case-sensitive
- Folder paths use ` > ` separator (with spaces)
- Multiple Todoist projects can map to the same Craft document
- Craft folders override document mappings for tasks created in those folders

### Step 3: Build Final Mapping

```bash
npm run map:build
```

This:
1. Reads your manual configuration
2. Fetches actual IDs and metadata from Craft and Todoist APIs
3. Validates that all mapped documents/projects exist
4. Generates `doc-project-mapper-v2.json` with ID-based mappings

**The build command will:**
- ✅ Resolve all document and folder IDs
- ✅ Create reverse mappings (Craft → Todoist)
- ⚠️ Warn if a mapped document/project doesn't exist
- ⚠️ Show which items will fallback to defaults

## Configuration Examples

### Example 1: Simple Mapping

All Vista Work-related Todoist projects go to one Craft document:

```json
{
  "todoistProjects": {
    "Vista Work": "Vista Work Tasks",
    "Guilds and Organisational": "Vista Work Tasks",
    "Projects": "Vista Work Tasks"
  }
}
```

### Example 2: Folder-Based Routing

Tasks created in specific Craft folders go to specific Todoist projects:

```json
{
  "craftFolders": {
    "Vista Work": "Vista Work",
    "Vista Work > Projects": "Projects",
    "Vista Work > Projects > Placement Engine": "Placement Engine"
  }
}
```

### Example 3: Combined Mapping

Mix document and folder mappings:

```json
{
  "todoistProjects": {
    "Professional": null,
    "Personal": "Personal Tasks"
  },
  "craftFolders": {
    "Professional": "Professional"
  }
}
```

Result:
- Todoist "Professional" tasks → Not mapped (uses Task Inbox)
- Craft "Professional" folder tasks → Go to Todoist "Professional"
- Todoist "Personal" tasks → Go to Craft "Personal Tasks"

## Updating Mappings

When you add new projects/folders or want to change mappings:

```bash
npm run map:init   # Regenerates template (will overwrite existing file!)
# Edit doc-project-mapping-manual.json
npm run map:build  # Rebuild final mapping
```

## File Locations

- **Manual Config**: `./doc-project-mapping-manual.json` (you edit this)
- **Built Config**: `./doc-project-mapper-v2.json` (generated, don't edit)

## Default Fallbacks

- **Craft**: Tasks with no mapping go to "Task Inbox" document
- **Todoist**: Tasks with no mapping go to "Inbox" project

These defaults are configurable in the sync engine.

## Troubleshooting

### "Document not found" error during build
- Check document title spelling (case-sensitive)
- Ensure document exists in Craft
- Verify you're using the exact document title

### "Project not found" error during build  
- Check project name spelling
- Verify project exists in Todoist
- Use exact project name from Todoist

### Tasks going to wrong location
- Check mapping order: Document mapping overrides folder mapping
- Verify built config was regenerated after manual edits
- Restart sync after building new mapping

### Need to reset everything
```bash
rm doc-project-mapping-manual.json doc-project-mapper-v2.json
npm run map:init
```

## Next Steps

1. ✅ Template generated at `doc-project-mapping-manual.json`
2. ⏳ Edit the file to add your mappings (see examples above)
3. ⏳ Run `npm run map:build` to generate final config
4. ⏳ Integrate the V2 resolver into syncEngine.ts
