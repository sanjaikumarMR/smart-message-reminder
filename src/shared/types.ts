export type ReminderStatus =
  | "upcoming"
  | "overdue"
  | "completed"
  | "dismissed"
  | "needs_confirmation";

export interface Reminder {
  id: string;
  task: string;
  dueAt: string | null;
  status: ReminderStatus;
  sourceChat: string | null;
  originalExcerpt: string | null;
  duplicateKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderDraft {
  task: string;
  dueAt: string | null;
  sourceChat?: string | null;
  originalExcerpt?: string | null;
  duplicateKey: string;
}

export interface ReminderSettings {
  monitoringEnabled: boolean;
  enabledChats: string[];
  saveMessageExcerpt: boolean;
  notificationsEnabled: boolean;
  leadTimeMinutes: number;
}

export type ExtensionMessage =
  | { type: "SET_MONITORING"; enabled: boolean }
  | {
      type: "IMPORT_SELECTED_MESSAGE";
      text: string;
      sourceChat: string | null;
      saveExcerpt: boolean;
    }
  | { type: "REMINDER_CREATED"; reminder: Reminder };

export type ExternalExtensionMessage =
  | { type: "GET_STATE" }
  | {
      type: "IMPORT_MESSAGE";
      text: string;
      sourceChat: string | null;
    }
  | {
      type: "UPDATE_REMINDER";
      id: string;
      patch: Partial<Pick<Reminder, "status" | "task" | "dueAt">>;
    }
  | { type: "DELETE_REMINDER"; id: string }
  | { type: "SAVE_SETTINGS"; settings: ReminderSettings }
  | { type: "CLEAR_DATA" };

export const DEFAULT_SETTINGS: ReminderSettings = {
  monitoringEnabled: false,
  enabledChats: [],
  saveMessageExcerpt: false,
  notificationsEnabled: true,
  leadTimeMinutes: 0,
};
