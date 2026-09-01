// Ambient declarations for pi runtime packages.
// The actual types are provided by whichever host loads this extension.
// tsconfig paths handles resolution when one of the packages is installed;
// these declarations serve as fallback when neither is available (e.g. CI, dev without pi).
declare module "@earendil-works/pi-coding-agent" {
  export interface ModelRegistry {
    getAvailable(): Array<{ provider: string; id: string }>;
    refresh(): void;
  }

  export interface EventBus {
    on(event: string, handler: (...args: any[]) => any): void;
    off(event: string, handler: (...args: any[]) => any): void;
    emit(event: string, ...args: any[]): void;
  }

  export interface ExtensionAPI {
    on(event: string, handler: (...args: any[]) => any): void;
    getCommands(): any[];
    sendMessage<T = unknown>(
      message: { customType: string; content: string; display: boolean; details?: T },
      options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" },
    ): void;
    sendUserMessage(message: string | any[]): void;
    setSessionName(name: string): void;
    getSessionName(): string | undefined;
    registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: any) => Promise<void> }): void;
    registerTool(tool: any): void;
    registerProvider(name: string, config: any): void;
    unregisterProvider(name: string): void;
    exec(command: string, args: string[], options?: { timeout?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
    events: EventBus;
  }
}

// Legacy fork — re-exports the same ExtensionAPI shape so existing installs still type-check.
declare module "@mariozechner/pi-coding-agent" {
  export type ExtensionAPI = import("@earendil-works/pi-coding-agent").ExtensionAPI;
  export type ModelRegistry = import("@earendil-works/pi-coding-agent").ModelRegistry;
  export type EventBus = import("@earendil-works/pi-coding-agent").EventBus;
}

declare module "@earendil-works/pi-ai" {
  export function StringEnum<T extends readonly string[]>(values: T, schema?: Record<string, unknown>): any;
}
declare module "@mariozechner/pi-ai" {
  export function StringEnum<T extends readonly string[]>(values: T, schema?: Record<string, unknown>): any;
}
