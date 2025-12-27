/**
 * Build final mapping from manual configuration
 */

import { CraftIntegration } from '../craft';
import { TodoistIntegration } from '../todoist';
import { ManualConfig, BuiltConfig } from './types';
import { CONSTANTS } from '../constants';
import * as fs from 'fs';

const INBOX_PROJECT_NAME = 'Inbox';
const TASK_INBOX_DOCUMENT_NAME = 'Task Inbox';

export class ConfigBuilder {
  constructor(
    private craft: CraftIntegration,
    private todoist: TodoistIntegration
  ) {}

  async build(manualConfigPath: string, outputPath: string): Promise<BuiltConfig> {
    console.log('🏗️  Building final mapping from manual configuration...\n');

    // Load manual config
    const manualConfig: ManualConfig = JSON.parse(fs.readFileSync(manualConfigPath, 'utf-8'));

    // Fetch API data
    console.log('Fetching Todoist projects with IDs...');
    const todoistProjects = await this.todoist.getAllProjects();
    const todoistProjectMap = new Map(todoistProjects.map(p => [p.name, p.id]));
    console.log(`  Found ${todoistProjects.length} projects\n`);

    console.log('Fetching Craft folders with IDs...');
    const craftFolderMap = await this.fetchCraftFolderMap();
    console.log(`  Found ${craftFolderMap.size} folders\n`);

    console.log('Fetching Craft documents with IDs...');
    const craftDocumentMap = await this.fetchCraftDocumentMap();
    console.log(`  Found ${craftDocumentMap.size} documents\n`);

    // Find defaults
    const inboxProjectId = todoistProjectMap.get(INBOX_PROJECT_NAME);
    if (!inboxProjectId) {
      throw new Error(`Inbox project "${INBOX_PROJECT_NAME}" not found in Todoist`);
    }

    const taskInboxDocId = craftDocumentMap.get(TASK_INBOX_DOCUMENT_NAME);
    if (!taskInboxDocId) {
      throw new Error(`Task Inbox document "${TASK_INBOX_DOCUMENT_NAME}" not found in Craft`);
    }

    // Build final config
    const builtConfig: BuiltConfig = {
      version: '2.0',
      lastUpdated: new Date().toISOString(),
      defaults: {
        todoistInboxProjectId: inboxProjectId,
        todoistInboxProjectName: INBOX_PROJECT_NAME,
        craftTaskInboxDocumentId: taskInboxDocId,
        craftTaskInboxDocumentName: TASK_INBOX_DOCUMENT_NAME,
      },
      documentToProject: {},
      folderToProject: {},
      projectToDocument: {},
    };

    let mapped = 0;

    // Process Todoist project → Craft document mappings
    for (const [todoistProjectName, craftDocumentName] of Object.entries(manualConfig.todoistProjects)) {
      if (!craftDocumentName) continue;
      const todoistProjectId = todoistProjectMap.get(todoistProjectName);
      if (!todoistProjectId) {
        console.warn(`  ⚠ Skipping ${todoistProjectName} (not found in Todoist projects)`);
        continue;
      }
      if (craftDocumentName === CONSTANTS.NOSYNC_TAG) {
        builtConfig.projectToDocument[todoistProjectId] = CONSTANTS.NOSYNC_TAG;
        console.log(`  ⏭️  Marked ${todoistProjectName} as nosync`);
        mapped++;
        continue;
      }
      const craftDocumentId = craftDocumentMap.get(craftDocumentName);
      if (craftDocumentId) {
        builtConfig.projectToDocument[todoistProjectId] = craftDocumentId;
        console.log(`  ✓ ${todoistProjectName} → ${craftDocumentName}`);
        mapped++;
      } else {
        console.warn(`  ⚠ Skipping ${todoistProjectName} → ${craftDocumentName} (not found in APIs)`);
      }
    }

    // Process Craft folder → Todoist project mappings
    for (const [craftFolderPath, todoistProjectName] of Object.entries(manualConfig.craftFolders)) {
      if (!todoistProjectName) continue;

      const craftFolderId = craftFolderMap.get(craftFolderPath);
      const todoistProjectId = todoistProjectMap.get(todoistProjectName);

      if (craftFolderId && todoistProjectId) {
        builtConfig.folderToProject[craftFolderId] = todoistProjectId;
        console.log(`  ✓ ${craftFolderPath} (folder) → ${todoistProjectName}`);
        mapped++;
      } else {
        console.warn(`  ⚠ Skipping ${craftFolderPath} → ${todoistProjectName} (not found in APIs)`);
      }
    }

    // Process Craft document → Todoist project mappings (if any)
    for (const [craftDocumentName, todoistProjectName] of Object.entries(manualConfig.craftDocuments)) {
      if (!todoistProjectName) continue;

      const craftDocumentId = craftDocumentMap.get(craftDocumentName);
      const todoistProjectId = todoistProjectMap.get(todoistProjectName);

      if (craftDocumentId && todoistProjectId) {
        builtConfig.documentToProject[craftDocumentId] = todoistProjectId;
        console.log(`  ✓ ${craftDocumentName} (doc) → ${todoistProjectName}`);
        mapped++;
      } else {
        console.warn(`  ⚠ Skipping ${craftDocumentName} → ${todoistProjectName} (not found in APIs)`);
      }
    }

    // Add metadata for debugging (reverse maps: ID -> name)
    builtConfig.metadata = {
      projects: Object.fromEntries(
        Array.from(todoistProjectMap.entries()).map(([name, id]) => [id, name])
      ),
      documents: Object.fromEntries(
        Array.from(craftDocumentMap.entries()).map(([name, id]) => [id, name])
      ),
      folders: Object.fromEntries(
        Array.from(craftFolderMap.entries()).map(([path, id]) => [id, path])
      ),
    };

    // Save to file
    fs.writeFileSync(outputPath, JSON.stringify(builtConfig, null, 2));
    console.log(`\n✅ Final mapping saved to: ${outputPath}`);
    console.log(`   Mapped: ${mapped} entries\n`);

    return builtConfig;
  }

  private async fetchCraftFolderMap(): Promise<Map<string, string>> {
    const folderMap = new Map<string, string>();

    try {
      const response = await (this.craft as any).client.get('/folders');
      const items = response.data.items || [];

      const extractFolders = (folderList: any[], parentPath: string = '') => {
        for (const folder of folderList) {
          if (['unsorted', 'daily_notes', 'trash', 'templates'].includes(folder.id)) {
            continue;
          }

          const folderPath = parentPath ? `${parentPath} > ${folder.name}` : folder.name;
          folderMap.set(folderPath, folder.id);

          if (folder.folders && folder.folders.length > 0) {
            extractFolders(folder.folders, folderPath);
          }
        }
      };

      extractFolders(items);
    } catch (error) {
      console.error('Error fetching folders:', error);
    }

    return folderMap;
  }

  private async fetchCraftDocumentMap(): Promise<Map<string, string>> {
    const documentMap = new Map<string, string>();

    try {
      // First, search for documents with content
      const response = await (this.craft as any).client.get('/documents/search', {
        params: {
          include: ' ',  // Space character to match all documents with content
        },
      });

      const items = response.data.items || [];
      const uniqueDocIds = [...new Set(items.map((item: any) => item.documentId).filter(Boolean))];

      // Extract document titles from search results
      for (const documentId of uniqueDocIds) {
        const searchItem = items.find((item: any) => item.documentId === documentId);
        let title = searchItem?.markdown || 'Untitled';
        
        // Clean up Craft's markdown formatting: remove ** markers and extra spaces
        title = String(title)
          .replace(/\*\*/g, '') // Remove all ** markers
          .replace(/\s+/g, ' ') // Collapse multiple spaces
          .trim();
          
        if (title && title !== 'Untitled') {
          documentMap.set(title, String(documentId));
        }
      }

      // Also specifically search for Task Inbox if not found
      if (!documentMap.has(TASK_INBOX_DOCUMENT_NAME)) {
        try {
          const taskInboxResponse = await (this.craft as any).client.get('/documents/search', {
            params: {
              include: TASK_INBOX_DOCUMENT_NAME,
            },
          });

          const taskInboxItems = taskInboxResponse.data.items || [];
          for (const item of taskInboxItems) {
            if (item.documentId) {
              const searchItem = item;
              let title = searchItem?.markdown || 'Untitled';
              title = String(title)
                .replace(/\*\*/g, '')
                .replace(/\s+/g, ' ')
                .trim();
              
              if (title === TASK_INBOX_DOCUMENT_NAME) {
                documentMap.set(title, String(item.documentId));
                break;
              }
            }
          }
        } catch (err) {
          console.warn('  Could not find Task Inbox document via search');
        }
      }

      // Also search through folders to find documents that might not have content
      try {
        const foldersResponse = await (this.craft as any).client.get('/folders');
        const folderItems = foldersResponse.data.items || [];

        const extractDocuments = (folders: any[]) => {
          for (const folder of folders) {
            // Check documents in this folder
            if (folder.documents && folder.documents.length > 0) {
              for (const doc of folder.documents) {
                if (doc.id && doc.name) {
                  const cleanName = String(doc.name)
                    .replace(/\*\*/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();
                  if (!documentMap.has(cleanName)) {
                    documentMap.set(cleanName, String(doc.id));
                  }
                }
              }
            }

            // Recursively check subfolders
            if (folder.folders && folder.folders.length > 0) {
              extractDocuments(folder.folders);
            }
          }
        };

        extractDocuments(folderItems);
      } catch (err) {
        console.warn('  Could not extract documents from folders');
      }

      // Search for any missing documents from manual config by name
      const allExpectedDocs = new Set<string>();
      const manualConfig = JSON.parse(require('fs').readFileSync('./doc-project-mapping-manual.json', 'utf-8'));
      
      // Collect all document names from manual config
      Object.values(manualConfig.todoistProjects).forEach((doc: any) => {
        if (doc) allExpectedDocs.add(doc);
      });
      Object.values(manualConfig.craftDocuments).forEach((doc: any) => {
        if (doc) allExpectedDocs.add(doc);
      });

      // Search for each missing document by name
      for (const docName of allExpectedDocs) {
        if (!documentMap.has(docName)) {
          try {
            const searchResponse = await (this.craft as any).client.get('/documents/search', {
              params: { include: docName },
            });
            
            const items = searchResponse.data.items || [];
            for (const item of items) {
              if (item.documentId) {
                let title = item.markdown || '';
                title = String(title)
                  .replace(/\*\*/g, '')
                  .replace(/\s+/g, ' ')
                  .trim();
                
                if (title === docName) {
                  documentMap.set(docName, String(item.documentId));
                  break;
                }
              }
            }
          } catch (err) {
            // Document not found
          }
        }
      }
    } catch (error) {
      console.error('Error fetching documents:', error);
    }

    return documentMap;
  }
}
