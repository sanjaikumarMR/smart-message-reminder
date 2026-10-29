import type {
  ExternalExtensionMessage,
  Reminder,
  ReminderSettings,
} from "../shared/types";

const EXTENSION_ID_KEY = "smart-message-reminder:extension-id";

export interface ExtensionState {
  reminders: Reminder[];
  settings: ReminderSettings;
}

export interface ExtensionImportResult {
  reminder: Reminder | null;
  duplicate: boolean;
}

export function isExtensionPage(): boolean {
  return (
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime?.id && chrome.storage?.local)
  );
}

export function getSavedExtensionId(): string {
  if (isExtensionPage()) return chrome.runtime.id;
  return localStorage.getItem(EXTENSION_ID_KEY) ?? "";
}

export function saveExtensionId(id: string): void {
  localStorage.setItem(EXTENSION_ID_KEY, id.trim());
}

export async function sendToExtension<T>(
  extensionId: string,
  message: ExternalExtensionMessage,
): Promise<T> {
  if (
    typeof chrome === "undefined" ||
    typeof chrome.runtime?.sendMessage !== "function"
  ) {
    throw new Error("Open this dashboard in Chrome to connect the extension.");
  }
  const response = await chrome.runtime.sendMessage(extensionId, message);
  if (!response?.ok) {
    throw new Error(response?.error ?? "The extension did not accept the request.");
  }
  return response.data as T;
}

export async function getExtensionState(
  extensionId: string,
): Promise<ExtensionState> {
  return sendToExtension<ExtensionState>(extensionId, { type: "GET_STATE" });
}
