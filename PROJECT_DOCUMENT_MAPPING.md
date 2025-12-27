# Project-Document Mapping System

## Overview

The Project-Document Mapping System enables intelligent routing of tasks between Todoist projects and Craft documents/folders, ensuring tasks are created in the right location automatically.

## Key Concepts

### Mapping Behavior

**During Updates (Existing Tasks)**:
- Tasks are NEVER moved between projects or documents
- Updates happen in-place on both sides
- Project/document associations are preserved

**During Creation (New Tasks)**:
- Project-to-document mapping is resolved automatically
- Mapping configuration determines target location
- Inbox is used as fallback when no mapping exists

### Storage

- **Database**: Both `project_id` (Todoist) and `craft_document_id` (Craft) are stored in the tasks table
- **Task Inbox Document**: A Craft document named "Task Inbox" (configurable in `constants.ts`) is used as fallback instead of Craft's inbox
- **Todoist Inbox**: Todoist inbox is still used for tasks without a mapped project

## Prerequisites

### Task Inbox Document

Before running sync or mapping generation, you **must** create a Craft document named **"Task Inbox"** (or the name specified in `src/constants.ts`).

This document serves as the fallback location for tasks that don't have a project mapping. If this document doesn't exist, sync will fail with an error message.

**To create it:**
1. Open Craft
2. Create a new document
3. Name it exactly "Task Inbox"
4. The document can be in any space/folder

## Mapping Configuration

### Auto-Generated Mapping

Run the mapping generator to create an initial configuration:

```bash
npm run map:docProject
```

This will:
1. Verify the Task Inbox document exists (throws error if not found)
2. Fetch all Craft documents and folders
3. Fetch all Todoist projects
4. Apply resolution rules (see below)
5. Generate `project-document-mapping.json`

### Resolution Rules

The system applies these rules in order of specificity:

1. **Manual Override** (Specificity: 4)
   - Highest priority
   - Defined in `manualOverrides` section of config
   - Example: Force a specific project to always map to a specific document

2. **Direct Name Match** (Specificity: 3)
   - Document name exactly matches project name
   - One-to-one mapping
   - Example: "Work" project → "Work" document

3. **Folder Match** (Specificity: 2)
   - Folder name matches project name
   - All documents in folder map to this project
   - More specific document mappings override folder mappings
   - Example: "Personal" project → "Personal" folder

4. **Parent Project Resolution** (Specificity: 1)
   - If project's parent has a mapping, inherit it
   - Only applies if parent maps to a document or folder
   - Example: "Work/Reports" inherits mapping from "Work"

5. **Task Inbox Document Fallback** (Specificity: 0)
   - Used when no other rule matches
   - Tasks go to the "Task Inbox" document
   - Must be created manually in Craft

### Specificity Example

```
Folder "Work" → Todoist project "Work"
Document "Work/Reports" → Todoist project "Reports"

Task in "Work/Standup" project:
  → Uses folder mapping (goes to "Work" folder in Craft)

Task in "Reports" project:
  → Uses document mapping (goes to "Work/Reports" document in Craft)
```

## Configuration File Format

```json
{
  "version": "1.0",
  "lastUpdated": "2025-12-15T09:00:00.000Z",
  "mappings": [
    {
      "todoistProjectId": "2203306141",
      "todoistProjectName": "Work",
      "todoistProjectPath": "Work",
      "craftTarget": {
        "type": "document",
        "id": "abc123",
        "name": "Work",
        "path": "Personal Space > Work"
      },
      "mappingSource": "direct",
      "specificity": 3
    }
  ],
  "manualOverrides": {
    "2203306142": {
      "craftTargetType": "document",
      "craftTargetId": "def456",
      "craftTargetPath": "Personal Space > Projects > Special",
      "note": "Custom mapping for important project"
    }
  }
}
```

## Manual Overrides

You can manually edit `project-document-mapping.json` to override auto-generated mappings:

### Adding an Override

1. Find the `todoistProjectId` from the `mappings` array
2. Add an entry to `manualOverrides`:

```json
"manualOverrides": {
  "YOUR_PROJECT_ID": {
    "craftTargetType": "document",
    "craftTargetId": "YOUR_DOCUMENT_ID",
    "craftTargetPath": "Space > Folder > Document",
    "note": "Why you made this override"
  }
}
```

### Override Types

- `"document"`: Map to specific document (tasks added at beginning)
- `"folder"`: Map to folder (requires additional implementation)

Note: There is no "inbox" type. All tasks must go to a document. Use the Task Inbox document ID to force tasks there.

## Task Creation Behavior

### Todoist → Craft

When creating a task from Todoist:
1. Look up project ID in mapping
2. Resolve Craft target (document/folder)
3. If document: Insert task at **beginning** of document
4. If no mapping: Use Task Inbox document (at beginning)
5. Store `craft_document_id` in database

### Craft → Todoist

When creating a task from Craft:
1. Look up document ID in mapping
2. Resolve Todoist project ID
3. If matched: Create in that project
4. If no match: Create in Todoist inbox
5. Store `project_id` in database

## Updating Mappings

### When to Regenerate

Run `npm run map:docProject` when:
- You create new Todoist projects
- You create new Craft documents/folders
- You rename projects or documents
- Project structure changes significantly

### Preserving Manual Overrides

The generator preserves existing manual overrides when regenerating the mapping file. Your custom mappings won't be lost.

## Best Practices

### Naming Consistency

Use consistent naming between Todoist projects and Craft documents for automatic matching:
- Good: "Work" project → "Work" document ✓
- Bad: "Work Stuff" project → "Professional" document ✗

### Fully Qualified Paths

The system uses full paths to avoid name collisions:
- `"Personal Space > Work > Reports"`
- `"Archive > Old Work"`

Even if both have a "Reports" document, they won't conflict.

### Manual Override Strategy

Use manual overrides for:
- Exception cases that don't fit the rule system
- Temporary routing during reorganization
- Special projects that need custom handling

### Folder vs Document

- **Document mapping**: Best for projects with many related tasks
- **Folder mapping**: Best for project hierarchies (sub-projects)
- **Specificity**: Document mappings always win over folder mappings

## Troubleshooting

### Task Inbox Document Not Found

If sync fails with "Task Inbox document not found":

1. Create a Craft document named "Task Inbox" (exact name)
2. Run sync again
3. Check `src/constants.ts` if you want to use a different name
4. Update `CRAFT_TASK_INBOX_DOCUMENT_NAME` constant

### Tasks Going to Task Inbox Document

If tasks are ending up in Task Inbox unexpectedly:

1. Check if mapping file exists: `project-document-mapping.json`
2. Run `npm run map:docProject` to generate/regenerate
3. Look for the project in the `mappings` array
4. Check `mappingSource`: if it's `"inbox"`, no match was found
5. Add a manual override if needed

### Name Mismatch

If project names don't exactly match document names:

1. Check the normalization (lowercase, spaces)
2. Add a manual override for that specific project
3. Consider renaming for consistency

### Document Not Found

If Craft document IDs become invalid:

1. Regenerate the mapping
2. Check if documents were moved/deleted
3. Update manual overrides with new document IDs

## Implementation Details

### Document Discovery

The system uses Craft's `/documents/search` API to discover documents. This has limitations:
- May not find all documents
- Folder hierarchy may be incomplete
- Consider manually adding important mappings

### Performance

- Mapping is loaded once at sync engine initialization
- No API calls during sync operations
- Mapping file is cached in memory

### Database Schema

Tasks table includes both:
- `project_id`: Todoist project ID
- `craft_document_id`: Craft document ID

These are preserved during updates and only set during creation.
