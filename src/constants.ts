/**
 * Application constants and configuration
 */

export const CONSTANTS = {
  /**
   * Tag/label to ignore tasks from syncing (configurable)
   */
  NOSYNC_TAG: 'nosync',
  /**
   * Name of the Craft document to use as fallback when no project mapping exists.
   * This document must be created manually in Craft before running sync.
   * The sync will throw an error if this document is not found.
   */
  CRAFT_TASK_INBOX_DOCUMENT_NAME: 'Task Inbox',

  /**
   * Conflict window in seconds - tasks modified within this window on both sides
   * are considered to have a conflict
   */
  CONFLICT_WINDOW_SECONDS: 3,

  /**
   * Batch size for creating tasks in Craft
   */
  CRAFT_BATCH_SIZE: 10,

  /**
   * Rate limiting delay in milliseconds
   */
  CRAFT_REQUEST_DELAY_MS: 1000,

  /**
   * Sync token storage key
   */
  TODOIST_SYNC_TOKEN_KEY: 'todoist_sync_token',
} as const;
