import type { ReminderSettings } from "../shared/types";
import {
  getCurrentChatName,
  getMessageElementsFromNode,
  getRenderedMessageElements,
  readVisibleMessage,
} from "./whatsappAdapter";

const SETTINGS_KEY = "smart-message-reminder:settings";
const ACTION_ID = "smart-message-reminder-import";
const TOOLBAR_ID = "smart-message-reminder-chat-control";
const DEFAULT_SETTINGS: ReminderSettings = {
  monitoringEnabled: false,
  monitoringChat: null,
  saveMessageExcerpt: false,
  notificationsEnabled: true,
  leadTimeMinutes: 0,
};
let settings: ReminderSettings = { ...DEFAULT_SETTINGS };
let action: HTMLButtonElement | null = null;
let toolbar: HTMLDivElement | null = null;
let toolbarButton: HTMLButtonElement | null = null;
let toolbarStatus: HTMLSpanElement | null = null;
let observedMain: HTMLElement | null = null;
let messageObserver: MutationObserver | null = null;
let lastObservedChat: string | null = null;
let lastMonitoringTarget: string | null = null;
let statusText = "Choose whether to monitor this chat.";
let statusExpiresAt = 0;
const processedMessageText = new WeakMap<HTMLElement, string>();
const pendingMessages = new WeakSet<HTMLElement>();

function isCurrentChatEnabled(chatName = getCurrentChatName()): boolean {
  return Boolean(
    settings.monitoringEnabled &&
      chatName &&
      settings.monitoringChat === chatName,
  );
}

function removeAction(): void {
  action?.remove();
  action = null;
}

function setStatus(text: string): void {
  statusText = text;
  statusExpiresAt = Date.now() + 10_000;
  if (toolbarStatus) toolbarStatus.textContent = text;
}

function renderToolbar(): void {
  const chatName = getCurrentChatName();
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = TOOLBAR_ID;
    Object.assign(toolbar.style, {
      position: "fixed",
      zIndex: "2147483646",
      top: "12px",
      right: "12px",
      display: "flex",
      flexDirection: "column",
      gap: "5px",
      padding: "9px",
      maxWidth: "280px",
      borderRadius: "10px",
      background: "#fff",
      color: "#252a34",
      font: "12px system-ui, sans-serif",
      boxShadow: "0 3px 16px #0003",
    });
    toolbarButton = document.createElement("button");
    toolbarButton.type = "button";
    Object.assign(toolbarButton.style, {
      padding: "8px 10px",
      border: "0",
      borderRadius: "7px",
      background: "#6763d2",
      color: "#fff",
      font: "600 12px system-ui, sans-serif",
      cursor: "pointer",
    });
    toolbarStatus = document.createElement("span");
    Object.assign(toolbarStatus.style, {
      color: "#6d7480",
      fontSize: "10px",
      lineHeight: "1.4",
    });
    toolbar.append(toolbarButton, toolbarStatus);
    document.body.append(toolbar);
    toolbarButton.addEventListener("click", () => {
      const currentChat = getCurrentChatName();
      if (!currentChat) {
        setStatus("Open a chat before enabling monitoring.");
        return;
      }
      const isEnabled = isCurrentChatEnabled(currentChat);
      settings = {
        ...settings,
        monitoringEnabled: isEnabled ? settings.monitoringEnabled : true,
        monitoringChat: isEnabled ? null : currentChat,
      };
      chrome.storage.local.set({ [SETTINGS_KEY]: settings }, () => {
        if (chrome.runtime.lastError) {
          setStatus(`Could not save setting: ${chrome.runtime.lastError.message}`);
          return;
        }
        statusText = isEnabled
          ? "Monitoring paused for this chat."
          : `Watching new visible messages in ${currentChat}.`;
        setStatus(statusText);
        seedCurrentView();
        renderToolbar();
      });
    });
  }

  if (toolbarButton) {
    toolbarButton.textContent = isCurrentChatEnabled(chatName)
      ? "Pause this chat"
      : "Monitor this chat";
    toolbarButton.disabled = !chatName;
    toolbarButton.style.opacity = chatName ? "1" : "0.55";
  }
  if (toolbarStatus) {
    if (statusExpiresAt > Date.now()) {
      toolbarStatus.textContent = statusText;
    } else if (isCurrentChatEnabled(chatName)) {
      toolbarStatus.textContent = `Monitoring new messages in ${chatName}.`;
    } else if (chatName) {
      toolbarStatus.textContent = `Not monitoring ${chatName}.`;
    } else {
      toolbarStatus.textContent = "Open a chat to enable message monitoring.";
    }
  }
}

function sendSelectedText(text: string, sourceChat: string | null): void {
  chrome.runtime
    .sendMessage({
      type: "IMPORT_SELECTED_MESSAGE",
      text,
      sourceChat,
      saveExcerpt: settings.saveMessageExcerpt,
    })
    .then((response) => {
      if (!response?.ok) {
        setStatus(response?.error ?? response?.message ?? "Could not import that text.");
      } else if (!response.reminder) {
        setStatus("No reminder phrase found in that selection.");
      } else if (response.duplicate) {
        setStatus("That message is already in your reminders.");
      } else {
        setStatus("Reminder saved. Open the dashboard to review it.");
      }
      renderToolbar();
    })
    .catch((error: unknown) => {
      console.error("Could not send selected message to the reminder service:", error);
      setStatus("Could not reach the reminder service. Reload the extension.");
    });
}

function showSelectionAction(selection: Selection): void {
  const sourceChat = getCurrentChatName();
  if (
    !isCurrentChatEnabled(sourceChat) ||
    selection.rangeCount === 0 ||
    !selection.toString().trim()
  ) {
    removeAction();
    return;
  }

  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  removeAction();
  action = document.createElement("button");
  action.id = ACTION_ID;
  action.type = "button";
  action.textContent = "✦ Add reminder";
  action.setAttribute("aria-label", "Analyze selected message for a reminder");
  Object.assign(action.style, {
    position: "fixed",
    zIndex: "2147483647",
    left: `${Math.min(Math.max(rect.left, 8), window.innerWidth - 150)}px`,
    top: `${Math.min(rect.bottom + 8, window.innerHeight - 42)}px`,
    padding: "9px 12px",
    border: "0",
    borderRadius: "8px",
    background: "#6763d2",
    color: "#fff",
    font: "600 12px system-ui, sans-serif",
    boxShadow: "0 3px 14px #0003",
    cursor: "pointer",
  });
  action.addEventListener("mousedown", (event) => event.preventDefault());
  action.addEventListener("click", () => {
    const text = selection.toString().trim();
    if (text) sendSelectedText(text, sourceChat);
    removeAction();
    window.getSelection()?.removeAllRanges();
  });
  document.body.append(action);
}

function seedCurrentView(): void {
  const main = document.querySelector("main");
  if (!main) return;
  for (const element of getRenderedMessageElements(main)) {
    processedMessageText.set(element, element.innerText.trim());
  }
  lastObservedChat = getCurrentChatName();
  lastMonitoringTarget = isCurrentChatEnabled(lastObservedChat)
    ? lastObservedChat
    : null;
}

function maybeImportNewMessage(element: HTMLElement): void {
  const currentText = element.innerText.trim();
  if (
    !currentText ||
    processedMessageText.get(element) === currentText ||
    pendingMessages.has(element)
  ) return;
  pendingMessages.add(element);
  window.setTimeout(() => {
    pendingMessages.delete(element);
    const updatedText = element.innerText.trim();
    if (!updatedText || processedMessageText.get(element) === updatedText) return;
    const chatName = getCurrentChatName();
    if (!isCurrentChatEnabled(chatName)) return;
    const visibleMessage = readVisibleMessage(element);
    if (!visibleMessage || visibleMessage.chatName !== settings.monitoringChat) return;
    processedMessageText.set(element, visibleMessage.text);
    chrome.runtime
      .sendMessage({
        type: "IMPORT_SELECTED_MESSAGE",
        text: visibleMessage.text,
        sourceChat: visibleMessage.chatName,
        saveExcerpt: settings.saveMessageExcerpt,
      })
      .then((response) => {
        if (!response?.ok) {
          setStatus(response?.error ?? "A visible message could not be processed.");
        } else if (response.reminder && response.duplicate) {
          setStatus("New message detected; this reminder was already saved.");
        } else if (response.reminder?.status === "needs_confirmation") {
          setStatus("Reminder saved; choose a date in the dashboard to schedule it.");
        } else if (response.reminder) {
          setStatus("Reminder created and scheduled.");
        } else {
          setStatus("New message detected, but no reminder phrase was found.");
        }
        renderToolbar();
      })
      .catch((error: unknown) => {
        console.error("Could not process a newly visible message:", error);
        setStatus("Could not reach the reminder service.");
      });
  }, 80);
}

function attachMessageObserver(): void {
  const main = document.querySelector("main");
  if (!(main instanceof HTMLElement) || main === observedMain) return;
  messageObserver?.disconnect();
  observedMain = main;
  seedCurrentView();
  messageObserver = new MutationObserver((mutations) => {
    const currentChat = getCurrentChatName();
    if (currentChat !== lastObservedChat) {
      seedCurrentView();
      return;
    }
    if (!isCurrentChatEnabled(currentChat)) return;
    const monitoringTarget = settings.monitoringChat;
    if (monitoringTarget !== lastMonitoringTarget) {
      seedCurrentView();
      return;
    }
    for (const mutation of mutations) {
      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          for (const element of getMessageElementsFromNode(node)) {
            maybeImportNewMessage(element);
          }
        }
      } else {
        for (const element of getMessageElementsFromNode(mutation.target)) {
          maybeImportNewMessage(element);
        }
      }
    }
  });
  messageObserver.observe(main, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["data-pre-plain-text"],
  });
}

function scanNewVisibleMessages(): void {
  const main = document.querySelector("main");
  if (!main || !isCurrentChatEnabled()) return;
  for (const element of getRenderedMessageElements(main)) {
    maybeImportNewMessage(element);
  }
}

function refreshSettings(): void {
  chrome.storage.local.get(SETTINGS_KEY, (result) => {
    if (chrome.runtime.lastError) {
      console.error("Could not read reminder settings:", chrome.runtime.lastError.message);
      setStatus("Could not read settings. Reload the extension.");
      return;
    }
    const previousTarget = settings.monitoringChat;
    const previousEnabled = settings.monitoringEnabled;
    const stored = result[SETTINGS_KEY] as Partial<ReminderSettings> | undefined;
    settings = { ...DEFAULT_SETTINGS, ...stored };
    if (
      settings.monitoringChat !== previousTarget ||
      settings.monitoringEnabled !== previousEnabled
    ) {
      seedCurrentView();
    }
    if (!isCurrentChatEnabled()) removeAction();
    renderToolbar();
  });
}

document.addEventListener("mouseup", () => {
  window.setTimeout(() => {
    const selection = window.getSelection();
    if (selection) showSelectionAction(selection);
  }, 0);
});
document.addEventListener("keyup", (event) => {
  if (event.key === "Escape") removeAction();
});
document.addEventListener("mousedown", (event) => {
  if ((event.target as HTMLElement).id !== ACTION_ID) removeAction();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) refreshSettings();
});

refreshSettings();
window.setInterval(() => {
  attachMessageObserver();
  scanNewVisibleMessages();
  renderToolbar();
}, 1000);
