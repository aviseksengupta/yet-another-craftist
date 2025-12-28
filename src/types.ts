/**
 * Type definitions for the sync system
 */

export enum TaskStatus {
  TODO = 'todo',
  DONE = 'done',
  CANCELLED = 'cancelled',
}

export enum SyncStatus {
  PENDING = 'pending',
  SYNCED = 'synced',
  CONFLICT = 'conflict',
  ERROR = 'error',
}

export interface Task {
  // Internal ID
  id?: number;

  // Core fields
  title: string;
  description?: string;

  // External IDs
  todoistId?: string;
  craftId?: string;

  // Dates (ISO format)
  scheduleDate?: string;  // Todoist 'due' date ↔ Craft 'scheduleDate'
  deadline?: string;      // Todoist 'deadline' ↔ Craft 'deadlineDate'

  // Status
  isCompleted: boolean;
  completedAt?: string;

  // Labels/Tags (combined from both Todoist labels and Craft hashtags)
  labels: string[];

  // Project/Document association
  projectId?: string; // Todoist project ID
  craftDocumentId?: string; // Craft document/page ID

  // Sync metadata
  lastModifiedTodoist?: string;
  lastModifiedCraft?: string;
  lastSynced?: string;
  syncStatus: SyncStatus;
  
  // Track which source has the latest data
  canonicalSource?: 'todoist' | 'craft' | 'db';
}

export interface TodoistTask {
  id: string;
  content: string;
  description?: string;
  project_id?: string;
  section_id?: string;
  parent_id?: string;
  labels?: string[];
  priority?: number;
  due?: {
    date: string;
    datetime?: string;
    string?: string;
    lang?: string;
    is_recurring?: boolean;
  };
  deadline?: string;
  is_completed?: boolean;
  completed_at?: string;
  created_at?: string;
  updated_at?: string; // Added from Sync API
}

export interface TodoistProject {
  id: string;
  name: string;
  parent_id?: string;
  order?: number;
  color?: string;
}

export interface CraftTask {
  id: string;
  markdown: string;
  taskInfo?: {
    state: 'todo' | 'done' | 'cancelled';
    scheduleDate?: string;
    deadlineDate?: string;
    completedAt?: string;
    canceledAt?: string;
  };
  metadata?: {
    lastModifiedAt?: string;
    createdAt?: string;
  };
}

export interface CraftBlock {
  id: string;
  type: string;
  markdown?: string;
  taskInfo?: {
    state: 'todo' | 'done' | 'cancelled';
    scheduleDate?: string;
    deadlineDate?: string;
    completedAt?: string;
  };
  content?: CraftBlock[];
  metadata?: {
    lastModifiedAt?: string;
    createdAt?: string;
  };
  location?: {
    path?: string;
    spaceId?: string;
  };
}

export interface Project {
  id?: number;
  todoistProjectId: string;
  craftFolderId?: string;
  craftDocumentId?: string;
  name: string;
  parentProjectId?: string;
  isLeaf: boolean;
  hasTasks: boolean;
  lastSynced?: string;
}

export interface SyncLog {
  id?: number;
  timestamp: string;
  operation: string;
  source: 'todoist' | 'craft' | 'system';
  entityType: 'task' | 'project' | 'sync';
  entityId?: string;
  details?: string;
  status: 'success' | 'error' | 'warning';
  errorMessage?: string;
}

export interface Config {
  todoistToken: string;
  craftApiBaseUrl: string;
  databasePath: string;
  syncInterval: number;
  conflictWindow: number;
  showPlanOnly: boolean;
}

export interface SyncOperations {
  createTodoist: Task[];
  updateTodoist: Task[];
  completeTodoist: Task[];
  createCraft: Task[];
  updateCraft: Task[];
  completeCraft: Task[];
  conflicts: Task[];
}
