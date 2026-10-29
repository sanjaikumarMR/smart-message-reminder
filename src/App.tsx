import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addReminder,
  clearAllData,
  deleteReminder,
  getReminders,
  getSettings,
  refreshReminderStatuses,
  saveSettings,
  updateReminder,
} from "./services/reminderStore";
import { parseReminderMessage } from "./services/messageParser";
import {
  getExtensionState,
  getSavedExtensionId,
  isExtensionPage,
  saveExtensionId,
  sendToExtension,
  type ExtensionImportResult,
} from "./services/extensionBridge";
import {
  DEFAULT_SETTINGS,
  type Reminder,
  type ReminderSettings,
  type ReminderStatus,
} from "./shared/types";

const sampleMessages = [
  "Remind me tomorrow to submit the assignment",
  "Please call me at 5 PM on Friday",
  "Don't forget to pay the bill next week",
];
const filters: Array<{ label: string; value: "all" | ReminderStatus }> = [
  { label: "All reminders", value: "all" },
  { label: "Upcoming", value: "upcoming" },
  { label: "Overdue", value: "overdue" },
  { label: "Needs review", value: "needs_confirmation" },
  { label: "Completed", value: "completed" },
  { label: "Dismissed", value: "dismissed" },
];

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function App() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [settings, setSettings] =
    useState<ReminderSettings>(DEFAULT_SETTINGS);
  const [filter, setFilter] = useState<"all" | ReminderStatus>("all");
  const [page, setPage] = useState<"dashboard" | "settings">("dashboard");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [extensionId, setExtensionId] = useState(getSavedExtensionId);
  const [extensionConnected, setExtensionConnected] = useState(isExtensionPage);

  const refresh = useCallback(async () => {
    if (extensionConnected && !isExtensionPage()) {
      try {
        const state = await getExtensionState(extensionId);
        setReminders(state.reminders);
        setSettings({ ...DEFAULT_SETTINGS, ...state.settings });
        return;
      } catch (error) {
        setExtensionConnected(false);
        setNotice(
          error instanceof Error
            ? `Extension connection lost: ${error.message}`
            : "Extension connection lost.",
        );
      }
    }
    const stored = await getReminders();
    setReminders(await refreshReminderStatuses(stored));
    setSettings(await getSettings());
  }, [extensionConnected, extensionId]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      extensionConnected ? 3000 : 60_000,
    );
    const onChanged = () => void refresh();
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(onChanged);
    }
    return () => {
      window.clearInterval(interval);
      if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(onChanged);
      }
    };
  }, [extensionConnected, refresh]);

  useEffect(() => {
    if (!isExtensionPage() && extensionId && !extensionConnected) {
      void connectToExtension(extensionId);
    }
  }, []);

  const visibleReminders = useMemo(() => {
    const filtered =
      filter === "all"
        ? reminders
        : reminders.filter((reminder) => reminder.status === filter);
    return filtered.sort((a, b) => {
      if (!a.dueAt) return 1;
      if (!b.dueAt) return -1;
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  }, [filter, reminders]);

  async function importMessage(text: string): Promise<void> {
    try {
      if (extensionConnected && !isExtensionPage()) {
        const result = await sendToExtension<ExtensionImportResult>(extensionId, {
          type: "IMPORT_MESSAGE",
          text,
          sourceChat: null,
        });
        if (!result.reminder) {
          setNotice("No reminder phrase found. Try a message with an action and date.");
          return;
        }
        setMessage("");
        setNotice(
          result.duplicate
            ? "That message has already been added."
            : result.reminder.dueAt
              ? "Reminder added to your connected Chrome extension."
              : "Reminder added. Please confirm its date or time.",
        );
        await refresh();
        return;
      }
      const draft = parseReminderMessage(text);
      if (!draft) {
        setNotice("No reminder phrase found. Try a message with an action and date.");
        return;
      }
      if (settings.saveMessageExcerpt) draft.originalExcerpt = text;
      const result = await addReminder(draft);
      await refresh();
      setMessage("");
      setNotice(
        result.duplicate
          ? "That message has already been added."
          : draft.dueAt
            ? "Reminder added."
            : "Reminder added. Please confirm its date or time.",
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not import that message.");
    }
  }

  async function updateSetting(
    patch: Partial<ReminderSettings>,
  ): Promise<void> {
    const next = { ...settings, ...patch };
    try {
      if (extensionConnected && !isExtensionPage()) {
        await sendToExtension(extensionId, { type: "SAVE_SETTINGS", settings: next });
      } else {
        await saveSettings(next);
      }
      setSettings(next);
      setNotice("Settings saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save settings.");
    }
  }

  async function modifyReminder(
    id: string,
    patch: Partial<Pick<Reminder, "status" | "task" | "dueAt">>,
  ): Promise<void> {
    try {
      if (extensionConnected && !isExtensionPage()) {
        await sendToExtension<Reminder | null>(extensionId, {
          type: "UPDATE_REMINDER",
          id,
          patch,
        });
      } else {
        await updateReminder(id, patch);
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update reminder.");
    }
  }

  async function snooze(reminder: Reminder): Promise<void> {
    const date = new Date();
    date.setMinutes(date.getMinutes() + 10);
    await modifyReminder(reminder.id, {
      dueAt: date.toISOString(),
      status: "upcoming",
    });
  }

  async function removeReminder(id: string): Promise<void> {
    try {
      if (extensionConnected && !isExtensionPage()) {
        await sendToExtension<boolean>(extensionId, {
          type: "DELETE_REMINDER",
          id,
        });
      } else {
        await deleteReminder(id);
      }
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete reminder.");
    }
  }

  async function clearData(): Promise<void> {
    if (!window.confirm("Delete all reminders and reset settings?")) return;
    try {
      if (extensionConnected && !isExtensionPage()) {
        await sendToExtension<boolean>(extensionId, { type: "CLEAR_DATA" });
      } else {
        await clearAllData();
      }
      await refresh();
      setNotice("Stored reminders and settings were deleted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete stored data.");
    }
  }

  async function connectToExtension(id: string): Promise<void> {
    const normalizedId = id.trim();
    if (!normalizedId) {
      setNotice("Enter the extension ID shown on chrome://extensions.");
      return;
    }
    try {
      const state = await getExtensionState(normalizedId);
      saveExtensionId(normalizedId);
      setExtensionId(normalizedId);
      setReminders(state.reminders);
      setSettings({ ...DEFAULT_SETTINGS, ...state.settings });
      setExtensionConnected(true);
      setNotice("Connected to the Chrome extension. Reminders will sync here.");
    } catch (error) {
      setExtensionConnected(false);
      setNotice(
        error instanceof Error
          ? `${error.message} Check the extension ID and reload the extension.`
          : "Could not connect. Check the extension ID and reload the extension.",
      );
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">✦</span>
          <span>Brightday</span>
        </div>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav className="navigation" aria-label="Main navigation">
          <button
            className={page === "dashboard" ? "nav-item active" : "nav-item"}
            onClick={() => setPage("dashboard")}
          >
            <span>▦</span> Dashboard
          </button>
          <button
            className={page === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => setPage("settings")}
          >
            <span>⚙</span> Settings
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-badge"><span /> Your messages stay private</div>
          <p>Smart Message Reminder</p>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <span>{page === "dashboard" ? "My reminders" : "Preferences"}</span>
          <div className="topbar-actions">
            <a className="whatsapp-link" href="https://web.whatsapp.com/" target="_blank" rel="noreferrer">
              <span aria-hidden="true">◉</span> Open WhatsApp
            </a>
            <button className="monitor-toggle" onClick={() => void updateSetting({ monitoringEnabled: !settings.monitoringEnabled })}>
              <span className={settings.monitoringEnabled ? "toggle on" : "toggle"}><i /></span>
              {settings.monitoringEnabled ? "Monitoring on" : "Monitor WhatsApp"}
            </button>
          </div>
        </header>

        {page === "dashboard" ? (
          <div className="content">
            <div className="welcome-row">
              <div>
                <p className="eyebrow">YOUR DAY, IN CONTROL</p>
                <h1>Make room for what matters.</h1>
                <p className="subheading">Keep every promise and deadline in one calm place.</p>
              </div>
              <div className="date-card">
                <span>✧</span>
                <div><small>TODAY</small><strong>{new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(new Date())}</strong></div>
              </div>
            </div>

            <section className="import-card">
              <div className="import-heading">
                <div className="whatsapp-icon">◉</div>
                <div><h2>Capture a commitment</h2><p>Paste a message or select text in your enabled WhatsApp chat.</p></div>
              </div>
              <form className="import-form" onSubmit={(event) => { event.preventDefault(); void importMessage(message); }}>
                <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="e.g. Remind me tomorrow to send the proposal…" aria-label="Message to analyze" />
                <button className="primary-button" type="submit">Find reminder <span>→</span></button>
              </form>
              <div className="samples">
                <span>TRY A SAMPLE</span>
                {sampleMessages.map((sample) => (
                  <button key={sample} onClick={() => setMessage(sample)}>{sample}</button>
                ))}
              </div>
            </section>

            <div className="section-title-row">
              <div><h2>Your reminders</h2><span className="count-pill">{reminders.length}</span></div>
              <span className="local-label"><span /> {extensionConnected ? "Synced with Chrome extension" : "Saved on this device"}</span>
            </div>

            <div className="filter-row">
              {filters.map((item) => (
                <button key={item.value} className={filter === item.value ? "filter-chip selected" : "filter-chip"} onClick={() => setFilter(item.value)}>
                  {item.label}{item.value !== "all" && <span>{reminders.filter((reminder) => reminder.status === item.value).length}</span>}
                </button>
              ))}
            </div>

            {visibleReminders.length ? (
              <div className="reminder-list">
                {visibleReminders.map((reminder) => (
                  <ReminderCard
                    key={reminder.id}
                    reminder={reminder}
                    onChange={(patch) => void modifyReminder(reminder.id, patch)}
                    onSnooze={() => void snooze(reminder)}
                    onDelete={() => void removeReminder(reminder.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state"><div>✧</div><h3>Nothing on this list yet</h3><p>Paste a message above or choose a sample to create your first reminder.</p></div>
            )}
          </div>
        ) : (
          <div className="content settings-content">
            <p className="eyebrow">MAKE IT YOURS</p>
            <h1>Privacy & notifications</h1>
            <p className="subheading">You’re in control of what is processed and saved.</p>

            <section className="settings-card">
              <h2>WhatsApp Web</h2>
              <p>Connect this dashboard to the extension to share reminders and settings. Open each chat you want monitored and choose <strong>Enable this chat</strong> in WhatsApp Web. Only chats you explicitly enable are monitored.</p>
              {!isExtensionPage() && (
                <div className="extension-connect">
                  <label htmlFor="extension-id">Chrome extension ID</label>
                  <div className="extension-connect-row">
                    <input id="extension-id" value={extensionId} onChange={(event) => setExtensionId(event.target.value)} placeholder="Paste the ID from chrome://extensions" />
                    <button className="primary-button" onClick={() => void connectToExtension(extensionId)}>{extensionConnected ? "Reconnect" : "Connect extension"}</button>
                    {extensionConnected && <button className="disconnect-button" onClick={() => { saveExtensionId(""); setExtensionId(""); setExtensionConnected(false); setNotice("Dashboard disconnected from the extension."); }}>Disconnect</button>}
                  </div>
                  <small>{extensionConnected ? "Connected. Extension reminders and dashboard changes stay in sync." : "Open chrome://extensions, copy the Smart Message Reminder ID, and paste it here."}</small>
                </div>
              )}
              {isExtensionPage() && <p className="connection-confirmation">This dashboard is running inside the extension and already shares its reminder storage.</p>}
              <SettingRow title="Enable WhatsApp monitoring" description={`Global pause. ${settings.enabledChats.length} chat${settings.enabledChats.length === 1 ? "" : "s"} explicitly enabled; open and enable other chats individually.`} checked={settings.monitoringEnabled} onChange={(checked) => void updateSetting({ monitoringEnabled: checked })} />
              {settings.enabledChats.length > 0 && (
                <div className="enabled-chats" aria-label="Enabled WhatsApp chats">
                  <strong>Enabled chats</strong>
                  {settings.enabledChats.map((chat) => (
                    <span className="enabled-chat" key={chat}>
                      {chat}
                      <button
                        aria-label={`Stop monitoring ${chat}`}
                        title={`Stop monitoring ${chat}`}
                        onClick={() => void updateSetting({ enabledChats: settings.enabledChats.filter((enabledChat) => enabledChat !== chat) })}
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
              <SettingRow title="Keep message excerpts" description="Off by default. If enabled, saved reminders may retain the source message text." checked={settings.saveMessageExcerpt} onChange={(checked) => void updateSetting({ saveMessageExcerpt: checked })} />
            </section>
            <section className="settings-card">
              <h2>Message privacy</h2>
              <p>Message text is processed locally in your browser and is not uploaded. Automatic monitoring is limited to newly added, visible messages in one chat you explicitly enable. Date-only reminders are set for 9:00 AM local time; messages without a clear date still need confirmation. Existing messages are not backfilled.</p>
            </section>
            <section className="settings-card">
              <h2>Notifications</h2>
              <p>Chrome must be running for browser-based reminders to fire.</p>
              <SettingRow title="Reminder notifications" description="Show a Chrome notification when a reminder is due." checked={settings.notificationsEnabled} onChange={(checked) => void updateSetting({ notificationsEnabled: checked })} />
              <label className="lead-time">Notify me
                <select value={settings.leadTimeMinutes} onChange={(event) => void updateSetting({ leadTimeMinutes: Number(event.target.value) })}>
                  <option value={0}>at the due time</option>
                  <option value={5}>5 minutes before</option>
                  <option value={10}>10 minutes before</option>
                  <option value={30}>30 minutes before</option>
                  <option value={60}>1 hour before</option>
                </select>
              </label>
            </section>
            <section className="settings-card danger-card">
              <h2>Stored data</h2>
              <p>Delete reminders and reset your preferences from this device.</p>
              <button className="danger-button" onClick={() => void clearData()}>Delete all stored data</button>
            </section>
          </div>
        )}
        {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      </section>
    </main>
  );
}

function ReminderCard({
  reminder,
  onChange,
  onSnooze,
  onDelete,
}: {
  reminder: Reminder;
  onChange: (patch: Partial<Pick<Reminder, "status" | "task" | "dueAt">>) => void;
  onSnooze: () => void;
  onDelete: () => void;
}) {
  const [task, setTask] = useState(reminder.task);
  useEffect(() => setTask(reminder.task), [reminder.task]);
  const statusLabel: Record<ReminderStatus, string> = {
    upcoming: "Upcoming",
    overdue: "Overdue",
    completed: "Completed",
    dismissed: "Dismissed",
    needs_confirmation: "Needs review",
  };
  return (
    <article className={`reminder-card status-${reminder.status}`}>
      <button className={reminder.status === "completed" ? "complete-check checked" : "complete-check"} aria-label="Mark complete" onClick={() => onChange({ status: reminder.status === "completed" ? "upcoming" : "completed" })}>{reminder.status === "completed" ? "✓" : ""}</button>
      <div className="reminder-main">
        <div className="reminder-title-row"><input aria-label="Reminder task" value={task} onChange={(event) => setTask(event.target.value)} onBlur={() => { if (task.trim() && task !== reminder.task) onChange({ task: task.trim() }); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /><span className={`status-label ${reminder.status}`}>{statusLabel[reminder.status]}</span></div>
        {reminder.originalExcerpt && <p className="excerpt">“{reminder.originalExcerpt}”</p>}
        <div className="reminder-meta">
          <label className="due-field">◷ <input aria-label="Reminder date and time" type="datetime-local" value={toLocalInput(reminder.dueAt)} onChange={(event) => onChange({ dueAt: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
          {reminder.sourceChat && <span>◉ {reminder.sourceChat}</span>}
        </div>
        {reminder.status === "needs_confirmation" && <p className="confirm-hint">Add a date and time above to schedule this reminder.</p>}
      </div>
      <div className="card-actions">
        {reminder.status !== "completed" && reminder.status !== "dismissed" && <button title="Snooze 10 minutes" onClick={onSnooze}>↻</button>}
        {reminder.status !== "dismissed" && <button title="Dismiss" onClick={() => onChange({ status: "dismissed" })}>—</button>}
        <button title="Delete reminder" onClick={onDelete}>×</button>
      </div>
    </article>
  );
}

function SettingRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="setting-row"><div><strong>{title}</strong><p>{description}</p></div><button role="switch" aria-checked={checked} className={checked ? "toggle on" : "toggle"} onClick={() => onChange(!checked)}><i /></button></div>
  );
}
