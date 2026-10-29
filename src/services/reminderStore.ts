import {
  DEFAULT_SETTINGS,
  type Reminder,
  type ReminderDraft,
  type ReminderSettings,
} from "../shared/types";

const REMINDERS_KEY = "smart-message-reminder:reminders";
const SETTINGS_KEY = "smart-message-reminder:settings";
const chromeStorageAvailable =
  typeof chrome !== "undefined" && Boolean(chrome.storage?.local);

function readLocal<T>(key: string, fallback: T): T {
  const value = localStorage.getItem(key);
  return value ? (JSON.parse(value) as T) : fallback;
}

async function readValue<T>(key: string, fallback: T): Promise<T> {
  if (!chromeStorageAvailable) return readLocal(key, fallback);
  const result = await chrome.storage.local.get(key);
  return (result[key] as T | undefined) ?? fallback;
}

async function writeValue<T>(key: string, value: T): Promise<void> {
  if (!chromeStorageAvailable) {
    localStorage.setItem(key, JSON.stringify(value));
    return;
  }
  await chrome.storage.local.set({ [key]: value });
}

export async function getReminders(): Promise<Reminder[]> {
  return readValue<Reminder[]>(REMINDERS_KEY, []);
}

export async function saveReminders(reminders: Reminder[]): Promise<void> {
  await writeValue(REMINDERS_KEY, reminders);
}

export async function addReminder(
  draft: ReminderDraft,
): Promise<{ reminder: Reminder; duplicate: boolean }> {
  const reminders = await getReminders();
  const existing = reminders.find(
    (reminder) => reminder.duplicateKey === draft.duplicateKey,
  );
  if (existing) return { reminder: existing, duplicate: true };

  const now = new Date().toISOString();
  const reminder: Reminder = {
    id: crypto.randomUUID(),
    task: draft.task,
    dueAt: draft.dueAt,
    status: draft.dueAt ? "upcoming" : "needs_confirmation",
    sourceChat: draft.sourceChat ?? null,
    originalExcerpt: draft.originalExcerpt ?? null,
    duplicateKey: draft.duplicateKey,
    createdAt: now,
    updatedAt: now,
  };
  await saveReminders([reminder, ...reminders]);
  return { reminder, duplicate: false };
}

export async function updateReminder(
  id: string,
  patch: Partial<Pick<Reminder, "task" | "dueAt" | "status">>,
): Promise<Reminder[]> {
  const reminders = await getReminders();
  const updated = reminders.map((reminder) =>
    reminder.id === id
      ? {
          ...reminder,
          ...patch,
          status:
            patch.dueAt !== undefined &&
            ["upcoming", "overdue", "needs_confirmation"].includes(reminder.status)
              ? patch.dueAt === null
                ? "needs_confirmation"
                : new Date(patch.dueAt).getTime() <= Date.now()
                  ? "overdue"
                  : "upcoming"
              : (patch.status ?? reminder.status),
          updatedAt: new Date().toISOString(),
        }
      : reminder,
  );
  await saveReminders(updated);
  return updated;
}

export async function deleteReminder(id: string): Promise<Reminder[]> {
  const reminders = (await getReminders()).filter(
    (reminder) => reminder.id !== id,
  );
  await saveReminders(reminders);
  return reminders;
}

export async function clearAllData(): Promise<void> {
  await saveReminders([]);
  await saveSettings(DEFAULT_SETTINGS);
}

export async function getSettings(): Promise<ReminderSettings> {
  const stored = await readValue<
    Partial<ReminderSettings> & { monitoringChat?: string | null }
  >(SETTINGS_KEY, DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    enabledChats:
      stored.enabledChats ??
      (stored.monitoringChat ? [stored.monitoringChat] : []),
  };
}

export async function saveSettings(
  settings: ReminderSettings,
): Promise<void> {
  await writeValue(SETTINGS_KEY, settings);
}

export async function refreshReminderStatuses(
  reminders: Reminder[],
): Promise<Reminder[]> {
  const now = Date.now();
  let changed = false;
  const refreshed = reminders.map((reminder) =>
    (() => {
      if (
        reminder.status === "upcoming" &&
        reminder.dueAt &&
        new Date(reminder.dueAt).getTime() < now
      ) {
        changed = true;
        return { ...reminder, status: "overdue" as const };
      }
      return reminder;
    })(),
  );
  if (changed) await saveReminders(refreshed);
  return refreshed;
}
