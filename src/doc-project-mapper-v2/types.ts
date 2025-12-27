/**
 * Doc-Project Mapper V2 - Manual Configuration Types
 */

// Manual configuration (user edits this)
export interface ManualConfig {
  // Todoist project name -> Craft document name (user fills in)
  todoistProjects: Record<string, string | null>;
  // Craft folder path -> Todoist project name (user fills in)
  craftFolders: Record<string, string | null>;
  // Craft document name -> Todoist project name (user fills in, optional)
  craftDocuments: Record<string, string | null>;
}

// Built configuration (generated from manual config + API data)
export interface BuiltConfig {
  version: string;
  lastUpdated: string;
  defaults: {
    todoistInboxProjectId: string;
    todoistInboxProjectName: string;
    craftTaskInboxDocumentId: string;
    craftTaskInboxDocumentName: string;
  };
  // Craft document ID -> Todoist project ID
  documentToProject: Record<string, string>;
  // Craft folder ID -> Todoist project ID
  folderToProject: Record<string, string>;
  // Todoist project ID -> Craft document ID
  projectToDocument: Record<string, string>;
  // Metadata for debugging (names alongside IDs)
  metadata?: {
    projects: Record<string, string>; // projectId -> projectName
    documents: Record<string, string>; // documentId -> documentName
    folders: Record<string, string>; // folderId -> folderPath
  };
}

export interface ResolutionResult {
  found: boolean;
  projectId?: string;
  projectName?: string;
  documentId?: string;
  documentName?: string;
  isDefault: boolean;
  nosync?: boolean;
}
