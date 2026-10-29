import {
  addReminder,
  clearAllData,
  deleteReminder,
  getReminders,
  getSettings,
  saveSettings,
  updateReminder,
} from "../services/reminderStore";
import { parseReminderMessage } from "../services/messageParser";
import type {
  ExternalExtensionMessage,
  ExtensionMessage,
  Reminder,
} from "../shared/types";

const ALARM_PREFIX = "smart-reminder:";

function alarmName(id: string): string {
  return `${ALARM_PREFIX}${id}`;
}

async function scheduleReminder(reminder: Reminder): Promise<void> {
  const name = alarmName(reminder.id);
  await chrome.alarms.clear(name);
  if (
    reminder.status !== "upcoming" ||
    !reminder.dueAt
  ) return;
  const settings = await getSettings();
  if (!settings.notificationsEnabled) return;

  const dueAt = new Date(reminder.dueAt).getTime();
  const requestedTime = dueAt - settings.leadTimeMinutes * 60_000;
  const scheduledTime = requestedTime <= Date.now() && dueAt > Date.now()
    ? dueAt
    : Math.max(requestedTime, Date.now() + 1000);
  chrome.alarms.create(name, { when: scheduledTime });
}

async function restoreAlarms(): Promise<void> {
  const alarms = await chrome.alarms.getAll();
  await Promise.all(
    alarms
      .filter((alarm) => alarm.name.startsWith(ALARM_PREFIX))
      .map((alarm) => chrome.alarms.clear(alarm.name)),
  );
  const reminders = await getReminders();
  await Promise.all(reminders.map(scheduleReminder));
}

async function handleSelectedMessage(
  message: Extract<ExtensionMessage, { type: "IMPORT_SELECTED_MESSAGE" }>,
): Promise<{ reminder: Reminder | null; duplicate: boolean }> {
  const draft = parseReminderMessage(message.text, message.sourceChat);
  if (!draft) return { reminder: null, duplicate: false };
  if (message.saveExcerpt) draft.originalExcerpt = message.text;
  const result = await addReminder(draft);
  if (!result.duplicate) {
    await scheduleReminder(result.reminder);
  }
  return result;
}

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === "IMPORT_SELECTED_MESSAGE") {
    void handleSelectedMessage(message)
      .then((result) =>
        sendResponse({
          ok: true,
          ...result,
          message: result.reminder
            ? undefined
            : "No reminder phrase was found in the selected text.",
        }),
      )
      .catch((error: unknown) => {
        console.error("Could not import selected message:", error);
        sendResponse({ ok: false, error: "Could not save this reminder." });
      });
    return true;
  }
  return false;
});

function isLocalDashboard(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(parsed.hostname)) ||
      (parsed.protocol === "https:" &&
        parsed.hostname === "smart-message-reminder-sanjaikumar.onrender.com")
    );
  } catch {
    return false;
  }
}

chrome.runtime.onMessageExternal.addListener(
  (message: ExternalExtensionMessage, sender, sendResponse) => {
    if (!isLocalDashboard(sender.url)) {
      sendResponse({ ok: false, error: "Only a local dashboard may connect." });
      return false;
    }

    void (async () => {
      switch (message.type) {
        case "GET_STATE":
          return {
            reminders: await getReminders(),
            settings: await getSettings(),
          };
        case "IMPORT_MESSAGE": {
          const draft = parseReminderMessage(message.text, message.sourceChat);
          if (!draft) {
            return { reminder: null, duplicate: false };
          }
          const settings = await getSettings();
          if (settings.saveMessageExcerpt) draft.originalExcerpt = message.text;
          const result = await addReminder(draft);
          if (!result.duplicate) await scheduleReminder(result.reminder);
          return result;
        }
        case "UPDATE_REMINDER": {
          const reminders = await updateReminder(message.id, message.patch);
          return reminders.find((reminder) => reminder.id === message.id) ?? null;
        }
        case "DELETE_REMINDER":
          await deleteReminder(message.id);
          await chrome.alarms.clear(alarmName(message.id));
          return true;
        case "SAVE_SETTINGS":
          await saveSettings(message.settings);
          await restoreAlarms();
          return message.settings;
        case "CLEAR_DATA": {
          await clearAllData();
          const alarms = await chrome.alarms.getAll();
          await Promise.all(
            alarms
              .filter((alarm) => alarm.name.startsWith(ALARM_PREFIX))
              .map((alarm) => chrome.alarms.clear(alarm.name)),
          );
          return true;
        }
      }
    })()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => {
        console.error("Local dashboard request failed:", error);
        sendResponse({ ok: false, error: "The extension could not complete that request." });
      });
    return true;
  },
);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const id = alarm.name.slice(ALARM_PREFIX.length);
  void (async () => {
    const reminders = await getReminders();
    const reminder = reminders.find((entry) => entry.id === id);
    if (!reminder || reminder.status !== "upcoming" || !reminder.dueAt) return;
    const settings = await getSettings();
    if (settings.notificationsEnabled) {
      chrome.notifications.create(id, {
        type: "basic",
        iconUrl: "icon.png",
        title: "Smart Message Reminder",
        message: reminder.task,
        priority: 1,
      });
    }
    if (new Date(reminder.dueAt).getTime() <= Date.now()) {
      await updateReminder(id, { status: "overdue" });
    }
  })().catch((error: unknown) => console.error("Reminder alarm failed:", error));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (
    changes["smart-message-reminder:reminders"] ||
    changes["smart-message-reminder:settings"]
  ) {
    void restoreAlarms().catch((error: unknown) =>
      console.error("Could not restore reminder alarms:", error),
    );
  }
});

chrome.runtime.onInstalled.addListener(() => {
  void restoreAlarms().catch((error: unknown) =>
    console.error("Could not restore reminder alarms:", error),
  );
});
chrome.runtime.onStartup.addListener(() => {
  void restoreAlarms().catch((error: unknown) =>
    console.error("Could not restore reminder alarms:", error),
  );
});
