/**
 * Database layer using better-sqlite3
 */

import Database from 'better-sqlite3';
import { Task, Project, SyncLog, SyncStatus } from './types';

export class DatabaseManager {
  private db: Database.Database;

  constructor(dbPath: string = './sync_data.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
    this.runMigrations();
  }

  private createTables(): void {
    // Tasks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        todoist_id TEXT UNIQUE,
        craft_id TEXT UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        schedule_date TEXT,
        deadline TEXT,
        labels TEXT,
        tags TEXT,
        is_completed BOOLEAN DEFAULT 0,
        completed_at TEXT,
        project_id TEXT,
        craft_document_id TEXT,
        last_modified_todoist TEXT,
        last_modified_craft TEXT,
        last_synced TEXT,
        sync_status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Projects table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        todoist_project_id TEXT UNIQUE,
        craft_folder_id TEXT,
        craft_document_id TEXT,
        name TEXT NOT NULL,
        parent_project_id TEXT,
        is_leaf BOOLEAN DEFAULT 1,
        has_tasks BOOLEAN DEFAULT 0,
        last_synced TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Sync log table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
        operation TEXT NOT NULL,
        source TEXT,
        entity_type TEXT,
        entity_id TEXT,
        details TEXT,
        status TEXT,
        error_message TEXT
      )
    `);

    // Sync state table for storing sync tokens
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        todoist_sync_token TEXT,
        last_sync_timestamp TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_todoist ON tasks(todoist_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_craft ON tasks(craft_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_projects_todoist ON projects(todoist_project_id);
      CREATE INDEX IF NOT EXISTS idx_sync_log_timestamp ON sync_log(timestamp);
    `);
  }

  private runMigrations(): void {
    // Check if tags column exists, if not add it
    const tableInfo = this.db.prepare("PRAGMA table_info(tasks)").all() as any[];
    const hasTagsColumn = tableInfo.some(col => col.name === 'tags');
    
    if (!hasTagsColumn) {
      console.log('Running migration: Adding tags column to tasks table');
      this.db.exec(`ALTER TABLE tasks ADD COLUMN tags TEXT`);
      console.log('Migration completed: tags column added');
    }
  }

  // Task operations
  getTaskByTodoistId(todoistId: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE todoist_id = ?').get(todoistId) as any;
    return row ? this.rowToTask(row) : null;
  }

  getTaskByCraftId(craftId: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE craft_id = ?').get(craftId) as any;
    return row ? this.rowToTask(row) : null;
  }

  getAllTasks(): Task[] {
    const rows = this.db.prepare('SELECT * FROM tasks').all() as any[];
    return rows.map(row => this.rowToTask(row));
  }

  upsertTask(task: Task): number {
    const labelsJson = JSON.stringify(task.labels || []);

    if (task.id) {
      // Update existing task
      const stmt = this.db.prepare(`
        UPDATE tasks SET
          todoist_id = ?,
          craft_id = ?,
          title = ?,
          description = ?,
          schedule_date = ?,
          deadline = ?,
          labels = ?,
          is_completed = ?,
          completed_at = ?,
          project_id = ?,
          craft_document_id = ?,
          last_modified_todoist = ?,
          last_modified_craft = ?,
          last_synced = ?,
          sync_status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

      stmt.run(
        task.todoistId,
        task.craftId,
        task.title,
        task.description,
        task.scheduleDate,
        task.deadline,
        labelsJson,
        task.isCompleted ? 1 : 0,
        task.completedAt,
        task.projectId,
        task.craftDocumentId,
        task.lastModifiedTodoist,
        task.lastModifiedCraft,
        task.lastSynced,
        task.syncStatus,
        task.id
      );

      return task.id;
    } else {
      // Try to find existing task
      let existing = null;
      if (task.todoistId) {
        existing = this.getTaskByTodoistId(task.todoistId);
      }
      if (!existing && task.craftId) {
        existing = this.getTaskByCraftId(task.craftId);
      }

      if (existing) {
        task.id = existing.id;
        return this.upsertTask(task);
      }

      // Insert new task
      const stmt = this.db.prepare(`
        INSERT INTO tasks (
          todoist_id, craft_id, title, description, schedule_date, deadline,
          labels, is_completed, completed_at, project_id, craft_document_id,
          last_modified_todoist, last_modified_craft, last_synced, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        task.todoistId,
        task.craftId,
        task.title,
        task.description,
        task.scheduleDate,
        task.deadline,
        labelsJson,
        task.isCompleted ? 1 : 0,
        task.completedAt,
        task.projectId,
        task.craftDocumentId,
        task.lastModifiedTodoist,
        task.lastModifiedCraft,
        task.lastSynced,
        task.syncStatus
      );

      return result.lastInsertRowid as number;
    }
  }

  // Project operations
  getProjectByTodoistId(todoistProjectId: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE todoist_project_id = ?').get(todoistProjectId) as any;
    return row ? this.rowToProject(row) : null;
  }

  getAllProjects(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects').all() as any[];
    return rows.map(row => this.rowToProject(row));
  }

  upsertProject(project: Project): number {
    const existing = this.getProjectByTodoistId(project.todoistProjectId);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE projects SET
          craft_folder_id = ?,
          craft_document_id = ?,
          name = ?,
          parent_project_id = ?,
          is_leaf = ?,
          has_tasks = ?,
          last_synced = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE todoist_project_id = ?
      `);

      stmt.run(
        project.craftFolderId,
        project.craftDocumentId,
        project.name,
        project.parentProjectId,
        project.isLeaf ? 1 : 0,
        project.hasTasks ? 1 : 0,
        project.lastSynced,
        project.todoistProjectId
      );

      return existing.id!;
    } else {
      const stmt = this.db.prepare(`
        INSERT INTO projects (
          todoist_project_id, craft_folder_id, craft_document_id, name,
          parent_project_id, is_leaf, has_tasks, last_synced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const result = stmt.run(
        project.todoistProjectId,
        project.craftFolderId,
        project.craftDocumentId,
        project.name,
        project.parentProjectId,
        project.isLeaf ? 1 : 0,
        project.hasTasks ? 1 : 0,
        project.lastSynced
      );

      return result.lastInsertRowid as number;
    }
  }

  // Sync log operations
  logSyncOperation(log: Omit<SyncLog, 'id' | 'timestamp'>): void {
    const stmt = this.db.prepare(`
      INSERT INTO sync_log (operation, source, entity_type, entity_id, details, status, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      log.operation,
      log.source,
      log.entityType,
      log.entityId,
      log.details,
      log.status,
      log.errorMessage
    );
  }

  getRecentSyncLogs(limit: number = 50): SyncLog[] {
    const rows = this.db.prepare(`
      SELECT * FROM sync_log 
      ORDER BY timestamp DESC 
      LIMIT ?
    `).all(limit) as any[];

    return rows.map(row => this.rowToSyncLog(row));
  }

  // Helper methods to convert rows to objects
  private rowToTask(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      todoistId: row.todoist_id,
      craftId: row.craft_id,
      scheduleDate: row.schedule_date,
      deadline: row.deadline,
      labels: row.labels ? JSON.parse(row.labels) : [],
      isCompleted: Boolean(row.is_completed),
      completedAt: row.completed_at,
      projectId: row.project_id,
      craftDocumentId: row.craft_document_id,
      lastModifiedTodoist: row.last_modified_todoist,
      lastModifiedCraft: row.last_modified_craft,
      lastSynced: row.last_synced,
      syncStatus: row.sync_status as SyncStatus,
    };
  }

  private rowToProject(row: any): Project {
    return {
      id: row.id,
      todoistProjectId: row.todoist_project_id,
      craftFolderId: row.craft_folder_id,
      craftDocumentId: row.craft_document_id,
      name: row.name,
      parentProjectId: row.parent_project_id,
      isLeaf: Boolean(row.is_leaf),
      hasTasks: Boolean(row.has_tasks),
      lastSynced: row.last_synced,
    };
  }

  // Sync state operations
  getTodoistSyncToken(): string | null {
    const row = this.db.prepare('SELECT todoist_sync_token FROM sync_state WHERE id = 1').get() as any;
    return row?.todoist_sync_token || null;
  }

  updateTodoistSyncToken(token: string): void {
    this.db.prepare(`
      INSERT INTO sync_state (id, todoist_sync_token, last_sync_timestamp, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        todoist_sync_token = excluded.todoist_sync_token,
        last_sync_timestamp = excluded.last_sync_timestamp,
        updated_at = excluded.updated_at
    `).run(token);
  }

  private rowToSyncLog(row: any): SyncLog {
    return {
      id: row.id,
      timestamp: row.timestamp,
      operation: row.operation,
      source: row.source,
      entityType: row.entity_type,
      entityId: row.entity_id,
      details: row.details,
      status: row.status,
      errorMessage: row.error_message,
    };
  }

  close(): void {
    this.db.close();
  }
}
