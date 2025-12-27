/**
 * Mapping Resolver V2
 * 
 * Core resolution logic for the mapping system:
 * 1. Craft→Todoist: Walk up folder hierarchy to find best match
 * 2. Todoist→Craft: Find primary document for project
 * 
 * Both default to Task Inbox when no mapping found
 */

import {
  MappingConfig,
  CraftResolutionResult,
  TodoistResolutionResult,
  CraftDocument,
} from './types';
import { MappingConfigManager } from './config';

export class MappingResolver {
  private configManager: MappingConfigManager;
  private config: MappingConfig | null = null;

  constructor(configManager: MappingConfigManager) {
    this.configManager = configManager;
  }

  /**
   * Initialize the resolver by loading configuration
   */
  initialize(): void {
    this.config = this.configManager.load();
  }

  /**
   * Resolve Craft task to Todoist project
   * 
   * Algorithm:
   * 1. Extract folder hierarchy from Craft task path
   * 2. Walk up the hierarchy from most specific to least specific
   * 3. Check each level against craftToTodoist mappings
   * 4. Return first match (highest specificity)
   * 5. If no match, return default (Task Inbox's project, if configured)
   * 
   * @param craftDocumentId - The Craft document ID containing the task
   * @param craftDocumentPath - Full hierarchy path of the document
   * @param craftFolderHierarchy - Array of folder IDs from root to document (optional)
   * @returns Resolution result with Todoist project ID
   */
  resolveCraftToTodoist(
    craftDocumentId: string,
    craftDocumentPath: string,
    craftFolderHierarchy?: string[]
  ): CraftResolutionResult {
    if (!this.config) {
      throw new Error('Resolver not initialized. Call initialize() first.');
    }

    // Check for document match
    for (const project of this.config.projects) {
      const docMatch = project.craftDocuments.find(d => d.id === craftDocumentId);
      if (docMatch) {
        return {
          found: true,
          todoistProjectId: project.todoistProjectId,
          todoistProjectName: project.todoistProjectName,
          matchedCraftPath: docMatch.path,
          matchType: 'document',
          isDefault: false,
        };
      }
    }

    // Check for folder match by path
    const pathParts = craftDocumentPath.split(' > ').map(p => p.trim());
    for (let i = pathParts.length - 2; i >= 0; i--) {
      const folderPath = pathParts.slice(0, i + 1).join(' > ');
      
      for (const project of this.config.projects) {
        const folderMatch = project.craftFolders.find(f => f.path === folderPath);
        if (folderMatch) {
          return {
            found: true,
            todoistProjectId: project.todoistProjectId,
            todoistProjectName: project.todoistProjectName,
            matchedCraftPath: folderMatch.path,
            matchType: 'folder',
            isDefault: false,
          };
        }
      }
    }

    return this.getDefaultCraftToTodoistResult();
  }

  /**
   * Resolve Todoist project to Craft document(s)
   * 
   * Algorithm:
   * 1. Look up project in todoistToCraft mappings
   * 2. If found, return craft targets with primary marked
   * 3. If not found, return Task Inbox document as default
   * 
   * @param todoistProjectId - The Todoist project ID
   * @returns Resolution result with Craft targets
   */
  resolveTodoistToCraft(todoistProjectId: string): TodoistResolutionResult {
    if (!this.config) {
      throw new Error('Resolver not initialized. Call initialize() first.');
    }

    const project = this.config.projects.find(p => p.todoistProjectId === todoistProjectId);

    if (project) {
      const primary = project.craftDocuments.find(d => d.isPrimary)!;
      
      // Check if this is using Task Inbox as fallback and has a parent
      if (primary.id === this.config.taskInbox.documentId && project.todoistParentProjectId) {
        // Try to use parent project's document
        const parentProject = this.config.projects.find(p => p.todoistProjectId === project.todoistParentProjectId);
        if (parentProject) {
          const parentPrimary = parentProject.craftDocuments.find(d => d.isPrimary)!;
          // Only use parent if it's not also Task Inbox
          if (parentPrimary.id !== this.config.taskInbox.documentId) {
            return {
              found: true,
              primaryDocument: parentPrimary,
              allDocuments: parentProject.craftDocuments,
              folders: parentProject.craftFolders,
              isDefault: false,
            };
          }
        }
      }
      
      return {
        found: true,
        primaryDocument: primary,
        allDocuments: project.craftDocuments,
        folders: project.craftFolders,
        isDefault: false,
      };
    }

    return this.getDefaultTodoistToCraftResult();
  }

  private getDefaultCraftToTodoistResult(): CraftResolutionResult {
    if (!this.config) {
      throw new Error('Resolver not initialized');
    }

    return {
      found: false,
      todoistProjectId: '',
      todoistProjectName: 'Inbox',
      matchedCraftPath: this.config.taskInbox.documentPath,
      matchType: 'default',
      isDefault: true,
    };
  }

  private getDefaultTodoistToCraftResult(): TodoistResolutionResult {
    if (!this.config) {
      throw new Error('Resolver not initialized');
    }

    const taskInbox = this.config.taskInbox;
    const primary: CraftDocument = {
      id: taskInbox.documentId,
      name: taskInbox.documentName,
      path: taskInbox.documentPath,
      isPrimary: true,
    };

    return {
      found: false,
      primaryDocument: primary,
      allDocuments: [primary],
      folders: [],
      isDefault: true,
    };
  }

  /**
   * Check if a Craft document/folder is explicitly mapped
   */
  isCraftMapped(craftId: string): boolean {
    if (!this.config) {
      throw new Error('Resolver not initialized');
    }

    return this.config.projects.some(p => 
      p.craftDocuments.some(d => d.id === craftId) ||
      p.craftFolders.some(f => f.id === craftId)
    );
  }

  isTodoistMapped(todoistProjectId: string): boolean {
    if (!this.config) {
      throw new Error('Resolver not initialized');
    }

    return this.config.projects.some(p => p.todoistProjectId === todoistProjectId);
  }

  getAllMappedTodoistProjects(): string[] {
    if (!this.config) {
      throw new Error('Resolver not initialized');
    }

    return this.config.projects.map(p => p.todoistProjectId);
  }
}
