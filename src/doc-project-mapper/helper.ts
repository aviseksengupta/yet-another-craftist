/**
 * Mapping Helper Utilities V2
 * 
 * Helper functions for:
 * - Initializing Task Inbox
 * - Building mappings from existing data
 * - Validating mappings
 * - Importing/exporting configurations
 */

import { CraftIntegration } from '../craft';
import { TodoistIntegration } from '../todoist';
import { CONSTANTS } from '../constants';
import { MappingConfig } from './types';
import { MappingConfigManager } from './config';

export class MappingHelper {
  private craft: CraftIntegration;
  private todoist: TodoistIntegration;
  private configManager: MappingConfigManager;

  constructor(
    craft: CraftIntegration,
    todoist: TodoistIntegration,
    configManager: MappingConfigManager
  ) {
    this.craft = craft;
    this.todoist = todoist;
    this.configManager = configManager;
  }

  /**
   * Find the Task Inbox document in Craft
   * This is required for initialization
   */
  async findTaskInboxDocument(): Promise<{
    id: string;
    name: string;
    path: string;
  } | null> {
    console.log(`🔍 Looking for Task Inbox document: "${CONSTANTS.CRAFT_TASK_INBOX_DOCUMENT_NAME}"...`);
    
    try {
      // Search for the Task Inbox document
      const response = await (this.craft as any).client.get('/documents/search', {
        params: {
          include: CONSTANTS.CRAFT_TASK_INBOX_DOCUMENT_NAME,
        },
      });

      const items = response.data.items || [];
      
      // Find exact match for Task Inbox document name
      for (const item of items) {
        if (item.documentId) {
          try {
            const docResponse = await (this.craft as any).client.get('/documents', {
              params: {
                id: item.documentId,
              },
            });

            const docs = docResponse.data.items || [];
            
            // Find the document with matching name
            for (const doc of docs) {
              const docName = (doc.name || doc.title || '').trim();
              
              if (docName === CONSTANTS.CRAFT_TASK_INBOX_DOCUMENT_NAME) {
                console.log(`  ✓ Found Task Inbox document: ${doc.id}`);
                return {
                  id: doc.id,
                  name: docName,
                  path: docName, // Simple path for inbox
                };
              }
            }
          } catch (err) {
            // Skip documents we can't fetch
          }
        }
      }
      
      console.log(`  ✗ Task Inbox document not found`);
      return null;
    } catch (error) {
      console.error(`  ✗ Error searching for Task Inbox:`, error);
      return null;
    }
  }

  /**
   * Initialize a new mapping configuration
   * Requires Task Inbox document to exist in Craft
   */
  async initializeConfig(): Promise<MappingConfig> {
    console.log('\n📋 Initializing Mapping Configuration\n');

    // Find Task Inbox
    const taskInbox = await this.findTaskInboxDocument();
    
    if (!taskInbox) {
      throw new Error(
        `Task Inbox document "${CONSTANTS.CRAFT_TASK_INBOX_DOCUMENT_NAME}" not found in Craft.\n` +
        `Please create this document manually before initializing the mapping system.\n` +
        `This document is used as the default fallback for unmapped tasks.`
      );
    }

    // Create empty configuration
    const config = this.configManager.createEmpty(
      taskInbox.id,
      taskInbox.name,
      taskInbox.path
    );

    console.log('✅ Configuration initialized with Task Inbox\n');
    console.log(`Task Inbox Document:`);
    console.log(`  ID: ${taskInbox.id}`);
    console.log(`  Name: ${taskInbox.name}`);
    console.log(`  Path: ${taskInbox.path}\n`);

    return config;
  }

  /**
   * Generate mappings by matching Todoist projects with Craft documents and folders
   */
  async ensureAllTodoistProjectsMapped(config: MappingConfig): Promise<MappingConfig> {
    console.log('\n🔄 Matching Todoist projects with Craft documents and folders...\n');

    const hierarchy = await this.todoist.getProjectHierarchy();
    const projects = Array.from(hierarchy.projects.values());
    console.log(`Found ${projects.length} Todoist projects`);
    
    // Debug: Show ALL projects with their parent_id field value
    console.log('\nProject Hierarchy Debug (ALL projects):');
    for (const proj of projects.slice(0, 10)) {
      console.log(`  ${proj.name} → parent_id: ${proj.parent_id || 'null'}`);
    }
    console.log('');

    // Search Craft for documents and folders
    console.log('Searching Craft documents...');
    const craftDocuments = await this.searchCraftDocuments();
    console.log(`Found ${craftDocuments.length} Craft documents`);
    
    console.log('Searching Craft folders/spaces...');
    const craftFolders = await this.searchCraftSpaces();
    console.log(`Found ${craftFolders.length} Craft folders/spaces\n`);

    let matched = 0;
    let added = 0;

    for (const project of projects) {
      const existing = config.projects.find(m => m.todoistProjectId === project.id);
      if (existing) continue;

      const projectPath = this.buildProjectPath(project.id, hierarchy.projects);
      
      // Match independently: documents and folders
      const docMatches = this.findMatchingCraftItems(project.name, craftDocuments);
      const folderMatches = this.findMatchingCraftItems(project.name, craftFolders);

      // Build craftDocuments array
      // If we have matches, use them; otherwise default to Task Inbox
      const craftDocs = docMatches.length > 0
        ? docMatches.map((doc, idx) => ({ ...doc, isPrimary: idx === 0 }))
        : [{
            id: config.taskInbox.documentId,
            name: config.taskInbox.documentName,
            path: config.taskInbox.documentPath,
            isPrimary: true,
          }];

      // Build craftFolders array from folder matches
      // These are independent of document matches
      const craftFolds = folderMatches.map(folder => ({
        id: folder.id,
        name: folder.name,
        path: folder.path,
      }));

      // Debug: log parent_id if present
      if (project.parent_id) {
        const parentProj = hierarchy.projects.get(project.parent_id);
        console.log(`    [Parent] ${project.name} → ${parentProj?.name} (${project.parent_id})`);
      }

      config.projects.push({
        todoistProjectId: project.id,
        todoistProjectName: project.name,
        todoistProjectPath: projectPath,
        todoistParentProjectId: project.parent_id,
        craftDocuments: craftDocs,
        craftFolders: craftFolds,
        note: docMatches.length > 0 
          ? `Auto-matched doc: ${docMatches[0].name}${folderMatches.length > 0 ? `, folder: ${folderMatches[0].name}` : ''}`
          : folderMatches.length > 0
          ? `Auto-matched folder: ${folderMatches[0].name}`
          : 'Using Task Inbox',
      });

      if (docMatches.length > 0 || folderMatches.length > 0) {
        const parts = [];
        if (docMatches.length > 0) parts.push(`doc: ${docMatches[0].name}`);
        if (folderMatches.length > 0) parts.push(`folder: ${folderMatches[0].name}`);
        console.log(`  ✓ ${project.name} → ${parts.join(', ')}`);
        matched++;
      }
      added++;
    }

    console.log(`\n✅ Matched: ${matched}, Added: ${added}, Total: ${config.projects.length}\n`);
    return config;
  }

  private async searchCraftDocuments(): Promise<Array<{ id: string; name: string; path: string }>> {
    const documents: Array<{ id: string; name: string; path: string }> = [];
    try {
      const response = await (this.craft as any).client.get('/documents/search', {
        params: { include: ' ' },
      });
      const items = response.data.items || [];
      const uniqueDocIds = [...new Set(items.map((item: any) => item.documentId).filter(Boolean))];

      console.log('  Debug: Found documents:');
      for (const documentId of uniqueDocIds) {
        try {
          const searchItem = items.find((item: any) => item.documentId === documentId);
          let title = searchItem?.markdown || 'Untitled';
          // Clean up Craft's markdown formatting: remove ** markers and extra spaces
          title = String(title)
            .replace(/\*\*/g, '') // Remove all ** markers
            .replace(/\s+/g, ' ') // Collapse multiple spaces
            .trim();
          if (title && title !== 'Untitled') {
            documents.push({ id: String(documentId), name: title, path: title });
            console.log(`    - ${title}`);
          }
        } catch (err) {}
      }
    } catch (error) {}
    return documents;
  }

  private async searchCraftSpaces(): Promise<Array<{ id: string; name: string; path: string }>> {
    const folders: Array<{ id: string; name: string; path: string }> = [];
    try {
      const response = await (this.craft as any).client.get('/folders');
      const items = response.data.items || [];
      
      // Recursively extract all folders from the hierarchy
      const extractFolders = (folderList: any[], parentPath: string = '') => {
        for (const folder of folderList) {
          // Skip special system folders
          if (folder.id === 'unsorted' || folder.id === 'daily_notes' || 
              folder.id === 'trash' || folder.id === 'templates') {
            continue;
          }
          
          const folderPath = parentPath ? `${parentPath} > ${folder.name}` : folder.name;
          folders.push({
            id: folder.id,
            name: folder.name,
            path: folderPath,
          });
          
          // Recursively process subfolders
          if (folder.folders && folder.folders.length > 0) {
            extractFolders(folder.folders, folderPath);
          }
        }
      };
      
      extractFolders(items);
    } catch (error) {
      console.error('Error fetching folders:', error);
    }
    return folders;
  }

  private findMatchingCraftItems(
    projectName: string,
    craftDocuments: Array<{ id: string; name: string; path: string }>
  ): Array<{ id: string; name: string; path: string }> {
    const normalized = projectName.toLowerCase().trim();
    const exact = craftDocuments.filter(doc => doc.name.toLowerCase().trim() === normalized);
    if (exact.length > 0) return exact;

    return craftDocuments.filter(doc => {
      const docName = doc.name.toLowerCase().trim();
      return docName.includes(normalized) || normalized.includes(docName);
    });
  }

  /**
   * Build fully qualified path for a Todoist project
   */
  private buildProjectPath(projectId: string, projectsMap: Map<string, any>): string {
    const parts: string[] = [];
    let currentId: string | undefined = projectId;

    while (currentId) {
      const project = projectsMap.get(currentId);
      if (!project) break;
      
      parts.unshift(project.name);
      currentId = project.parent_id;
    }

    return parts.join(' > ');
  }

  async importFromV1(v1ConfigPath: string): Promise<MappingConfig> {
    console.log('\n📥 V1 import not needed - using smart matching instead\n');
    return await this.initializeConfig();
  }

  /**
   * Print a summary of the current configuration
   */
  printSummary(config: MappingConfig): void {
    console.log('\n📊 Mapping Configuration Summary\n');
    console.log(`Version: ${config.version}`);
    console.log(`Last Updated: ${config.lastUpdated}\n`);
    
    console.log(`Task Inbox:`);
    console.log(`  Document: ${config.taskInbox.documentName}`);
    console.log(`  ID: ${config.taskInbox.documentId}\n`);
    
    const matched = config.projects.filter(
      p => p.craftDocuments[0].id !== config.taskInbox.documentId
    );
    const defaulted = config.projects.filter(
      p => p.craftDocuments[0].id === config.taskInbox.documentId
    );

    console.log(`Total Projects: ${config.projects.length}`);
    console.log(`  Matched: ${matched.length}`);
    console.log(`  Using Task Inbox: ${defaulted.length}\n`);

    if (matched.length > 0) {
      console.log('Sample Matched:');
      matched.slice(0, 10).forEach(m => {
        console.log(`  • ${m.todoistProjectName} → ${m.craftDocuments[0].name}`);
      });
      if (matched.length > 10) {
        console.log(`  ... and ${matched.length - 10} more`);
      }
    }
  }
}
