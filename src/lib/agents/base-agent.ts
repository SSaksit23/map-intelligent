/**
 * Base Agent Class - CrewAI-inspired architecture
 * All specialized agents extend this base class
 */

import type { AgentRole, Task, TaskResult, AgentContext } from "./types";

export abstract class BaseAgent {
  protected role: AgentRole;
  protected context: AgentContext;
  protected verbose: boolean;

  constructor(role: AgentRole, context: AgentContext) {
    this.role = role;
    this.context = context;
    this.verbose = role.verbose ?? false;
  }

  // Get agent info
  getName(): string {
    return this.role.name;
  }

  getGoal(): string {
    return this.role.goal;
  }

  // Log method for verbose mode
  protected log(message: string, data?: unknown): void {
    if (this.verbose) {
      console.log(`[${this.role.name}] ${message}`, data ?? "");
    }
  }

  // Abstract method - each agent implements its own execution logic
  abstract execute(task: Task): Promise<TaskResult>;

  // Helper to create success result
  protected success<T>(data: T, executionTime?: number): TaskResult<T> {
    return {
      success: true,
      data,
      executionTime,
      agentName: this.role.name,
    };
  }

  // Helper to create error result
  protected error(message: string): TaskResult {
    return {
      success: false,
      error: message,
      agentName: this.role.name,
    };
  }

  // Get data from previous task results
  protected getPreviousResult<T>(taskId: string): T | undefined {
    const result = this.context.previousResults.get(taskId);
    return result?.data as T | undefined;
  }

  // Store data in shared memory
  protected setSharedMemory(key: string, value: unknown): void {
    this.context.sharedMemory.set(key, value);
  }

  // Get data from shared memory
  protected getSharedMemory<T>(key: string): T | undefined {
    return this.context.sharedMemory.get(key) as T | undefined;
  }
}
