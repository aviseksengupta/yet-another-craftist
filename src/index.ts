#!/usr/bin/env node

/**
 * Main entry point for the Craft-Todoist sync system
 */

import * as schedule from 'node-schedule';
import * as fs from 'fs';
import * as path from 'path';
import { getConfig, displayConfig } from './config';
import { DatabaseManager } from './database';
import { TodoistIntegration } from './todoist';
import { CraftIntegration } from './craft';
import { SyncEngine } from './syncEngine';

class SyncRunner {
  private db: DatabaseManager;
  private todoist: TodoistIntegration;
  private craft: CraftIntegration;
  private syncEngine: SyncEngine;
  private config: ReturnType<typeof getConfig>;
  private running: boolean = false;
  private scheduleJob?: schedule.Job;
  private lockFilePath: string;
  private hasLock: boolean = false;
  private isCleanedUp: boolean = false;

  constructor() {
    // Load configuration
    this.config = getConfig();

    // Set lock file path (same directory as database)
    const dbDir = path.dirname(this.config.databasePath);
    this.lockFilePath = path.join(dbDir, '.sync.lock');

    // Initialize components
    console.log('Initializing sync components...');
    this.db = new DatabaseManager(this.config.databasePath);
    this.todoist = new TodoistIntegration(this.config.todoistToken);
    this.craft = new CraftIntegration(this.config.craftApiBaseUrl, 1000); // 1000ms (1 second) delay between requests
    this.syncEngine = new SyncEngine(
      this.db,
      this.todoist,
      this.craft,
      this.config.conflictWindow,
      this.config.showPlanOnly
    );

    console.log('Sync runner initialized successfully');
    displayConfig(this.config);
  }

  /**
   * Initialize async components (must be called before running sync)
   */
  async initialize(): Promise<void> {
    await this.syncEngine.initialize();
  }

  /**
   * Attempt to acquire the lock file
   * Returns true if lock acquired, false if another instance is running
   */
  private acquireLock(): boolean {
    try {
      // Check if lock file exists and is still valid
      if (fs.existsSync(this.lockFilePath)) {
        const lockContent = fs.readFileSync(this.lockFilePath, 'utf8');
        const lockData = JSON.parse(lockContent);
        const lockAge = Date.now() - lockData.timestamp;
        
        // If lock is older than 30 minutes, consider it stale and remove it
        if (lockAge > 30 * 60 * 1000) {
          console.log('Removing stale lock file...');
          fs.unlinkSync(this.lockFilePath);
        } else {
          console.log('Another sync instance is already running.');
          console.log(`Lock acquired at: ${new Date(lockData.timestamp).toISOString()}`);
          console.log(`PID: ${lockData.pid}`);
          return false;
        }
      }

      // Create lock file
      const lockData = {
        pid: process.pid,
        timestamp: Date.now(),
        startedAt: new Date().toISOString()
      };
      fs.writeFileSync(this.lockFilePath, JSON.stringify(lockData, null, 2));
      this.hasLock = true;
      console.log(`Lock acquired (PID: ${process.pid})`);
      return true;
    } catch (error) {
      console.error('Failed to acquire lock:', error);
      return false;
    }
  }

  /**
   * Release the lock file
   */
  private releaseLock(): void {
    if (this.hasLock && fs.existsSync(this.lockFilePath)) {
      try {
        fs.unlinkSync(this.lockFilePath);
        this.hasLock = false;
        console.log('Lock released');
      } catch (error) {
        console.error('Failed to release lock:', error);
      }
    }
  }

  async runOnce(): Promise<void> {
    // Try to acquire lock
    if (!this.acquireLock()) {
      console.log('Exiting: Another sync instance is already running.');
      console.log('This sync will be skipped and retried in the next cycle.');
      // Close database connection before exiting - don't exit immediately
      this.cleanup();
      return; // Exit gracefully without process.exit
    }

    try {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Starting sync at ${new Date().toISOString()}`);
      console.log('='.repeat(80) + '\n');

      await this.initialize();
      await this.syncEngine.fullSync();

      console.log(`\n${'='.repeat(80)}`);
      console.log(`Sync completed at ${new Date().toISOString()}`);
      console.log('='.repeat(80) + '\n');
    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    } finally {
      // Always cleanup, even on error
      this.cleanup();
    }
  }

  async runContinuous(): Promise<void> {
    console.log(`\nStarting continuous sync (interval: ${this.config.syncInterval}s)`);
    console.log('Press Ctrl+C to stop\n');

    this.running = true;

    // Set up signal handlers for graceful shutdown
    process.on('SIGINT', () => this.handleShutdown());
    process.on('SIGTERM', () => this.handleShutdown());

    // Run first sync immediately
    await this.runOnce();

    // Schedule recurring sync
    const intervalMinutes = Math.floor(this.config.syncInterval / 60);
    const rule = `*/${intervalMinutes} * * * *`; // Every N minutes

    this.scheduleJob = schedule.scheduleJob(rule, async () => {
      if (this.running) {
        await this.runOnce();
      }
    });

    // Keep process alive
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (!this.running) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }

  async showStatus(): Promise<void> {
    console.log('\n' + '='.repeat(80));
    console.log('SYNC STATUS');
    console.log('='.repeat(80));

    // Get task counts
    const allTasks = this.db.getAllTasks();

    const synced = allTasks.filter(t => t.syncStatus === 'synced').length;
    const pending = allTasks.filter(t => t.syncStatus === 'pending').length;
    const conflicts = allTasks.filter(t => t.syncStatus === 'conflict').length;
    const errors = allTasks.filter(t => t.syncStatus === 'error').length;

    const completed = allTasks.filter(t => t.isCompleted).length;
    const active = allTasks.filter(t => !t.isCompleted).length;

    console.log('\nTask Statistics:');
    console.log(`  Total tasks: ${allTasks.length}`);
    console.log(`  Active: ${active}`);
    console.log(`  Completed: ${completed}`);
    console.log('\nSync Status:');
    console.log(`  Synced: ${synced}`);
    console.log(`  Pending: ${pending}`);
    console.log(`  Conflicts: ${conflicts}`);
    console.log(`  Errors: ${errors}`);

    // Show recent logs
    console.log('\nRecent Sync Operations:');
    const recentLogs = this.db.getRecentSyncLogs(10);
    for (const log of recentLogs) {
      const statusIcon = log.status === 'success' ? '✓' : log.status === 'error' ? '✗' : '⚠';
      console.log(`  ${statusIcon} ${log.timestamp} - ${log.operation} (${log.source})`);
    }

    console.log('='.repeat(80) + '\n');
  }

  private handleShutdown(): void {
    console.log('\nReceived shutdown signal, shutting down gracefully...');
    this.running = false;

    if (this.scheduleJob) {
      this.scheduleJob.cancel();
    }

    this.cleanup();
    // Allow cleanup to complete before Node exits naturally
  }

  private cleanup(): void {
    if (this.isCleanedUp) {
      return; // Already cleaned up, prevent double cleanup
    }
    this.isCleanedUp = true;

    console.log('Cleaning up resources...');
    try {
      this.db.close();
      console.log('Database connection closed');
    } catch (error) {
      console.error('Error closing database:', error);
    }
    this.releaseLock();
    console.log('Shutdown complete');
  }
}

async function main() {
  const command = process.argv[2] || 'once';

  if (!['once', 'continuous', 'status'].includes(command)) {
    console.error('Usage: npm start [once|continuous|status]');
    console.error('  once       - Run a single sync cycle');
    console.error('  continuous - Run continuous sync on schedule');
    console.error('  status     - Show sync status and statistics');
    process.exit(1);
  }

  let runner: SyncRunner | null = null;

  try {
    runner = new SyncRunner();

    if (command === 'once') {
      await runner.runOnce();
    } else if (command === 'continuous') {
      await runner.runContinuous();
    } else if (command === 'status') {
      await runner.showStatus();
    }
  } catch (error) {
    console.error('Fatal error:', error);
    // Ensure cleanup happens even on fatal error
    if (runner) {
      try {
        // @ts-ignore - accessing private method for cleanup
        runner['cleanup']();
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError);
      }
    }
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

export { SyncRunner };
