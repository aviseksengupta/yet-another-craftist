/**
 * Mapping System V2 - Type Definitions
 * 
 * Single unified mapping per Todoist project
 */

export interface CraftDocument {
  id: string;
  name: string;
  path: string;
  isPrimary: boolean;
}

export interface CraftFolder {
  id: string;
  name: string;
  path: string;
}

export interface ProjectMapping {
  todoistProjectId: string;
  todoistProjectName: string;
  todoistProjectPath: string;
  todoistParentProjectId?: string;
  craftDocuments: CraftDocument[];
  craftFolders: CraftFolder[];
  note?: string;
}

export interface MappingConfig {
  version: string;
  lastUpdated: string;
  taskInbox: {
    documentId: string;
    documentName: string;
    documentPath: string;
  };
  projects: ProjectMapping[];
}

export interface CraftResolutionResult {
  found: boolean;
  todoistProjectId: string;
  todoistProjectName: string;
  matchedCraftPath: string;
  matchType: 'document' | 'folder' | 'default';
  isDefault: boolean;
}

export interface TodoistResolutionResult {
  found: boolean;
  primaryDocument: CraftDocument;
  allDocuments: CraftDocument[];
  folders: CraftFolder[];
  isDefault: boolean;
}

// Legacy support
export interface CraftTarget {
  type: 'document' | 'folder';
  id: string;
  name: string;
  path: string;
  isPrimary?: boolean;
}
