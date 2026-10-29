import type { ReminderDraft } from "../shared/types";

const REMINDER_INTENT =
  /\b(remind(?:\s+me)?|remember\s+to|don't\s+forget\s+to|do\s+not\s+forget\s+to|need\s+to|must|call\s+me|pay|submit|call|send|email|attend|book|pick\s+up|renew|finish|complete|schedule|by)\b/i;
const EVENT_CONTEXT = /\b(exam|test|appointment|meeting|meet|date|deadline|due|interview|class|flight|reservation|event)\b/i;
const DATE_CONTEXT =
  /\b(?:tomorrow|today|next\s+week|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|20\d{2}-\d{1,2}-\d{1,2}|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const REMINDER_PREFIX =
  /\b(remind(?:\s+me)?|remember\s+to|don't\s+forget\s+to|do\s+not\s+forget\s+to|need\s+to|must)\b/i;
const TIME_PATTERN = /\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i;
const ISO_DATE_PATTERN = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/;
const MONTH_DATE_PATTERN =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/i;
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function nextWeekday(reference: Date, weekday: number): Date {
  const date = new Date(reference);
  let daysAhead = (weekday - date.getDay() + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;
  date.setDate(date.getDate() + daysAhead);
  return date;
}

function extractDate(text: string, reference: Date): Date | null {
  const lower = text.toLowerCase();
  const date = new Date(reference);
  date.setHours(9, 0, 0, 0);

  if (/\btomorrow\b/.test(lower)) {
    date.setDate(date.getDate() + 1);
    return date;
  }
  if (/\btoday\b/.test(lower)) return date;
  const weekdayIndex = WEEKDAYS.findIndex((day) =>
    new RegExp(`\\b(?:next\\s+)?${day}\\b`, "i").test(text),
  );
  if (weekdayIndex >= 0) return nextWeekday(date, weekdayIndex);

  const isoMatch = ISO_DATE_PATTERN.exec(text);
  if (isoMatch) {
    const explicit = new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
      9,
    );
    if (
      explicit.getFullYear() === Number(isoMatch[1]) &&
      explicit.getMonth() === Number(isoMatch[2]) - 1 &&
      explicit.getDate() === Number(isoMatch[3])
    ) {
      return explicit;
    }
    return null;
  }

  const monthMatch = MONTH_DATE_PATTERN.exec(text);
  if (monthMatch) {
    const monthIndex = MONTHS.findIndex((month) =>
      month.startsWith(monthMatch[1].toLowerCase().slice(0, 3)),
    );
    const day = Number(monthMatch[2]);
    let year = monthMatch[3] ? Number(monthMatch[3]) : reference.getFullYear();
    let explicit = new Date(year, monthIndex, day, 9);
    if (
      explicit.getMonth() !== monthIndex ||
      explicit.getDate() !== day ||
      monthIndex < 0
    ) {
      return null;
    }
    if (!monthMatch[3] && explicit < reference) {
      year += 1;
      explicit = new Date(year, monthIndex, day, 9);
    }
    return explicit;
  }
  return null;
}

function applyTime(date: Date, text: string): Date | null {
  const match = TIME_PATTERN.exec(text);
  if (!match) return date;
  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  const meridiem = match[3].toLowerCase().replaceAll(".", "");
  if (hours < 1 || hours > 12 || minutes > 59) return null;
  if (meridiem === "pm" && hours !== 12) hours += 12;
  if (meridiem === "am" && hours === 12) hours = 0;
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function makeDuplicateKey(sourceChat: string | null, text: string): string {
  const normalized = `${normalizeText(sourceChat ?? "")}|${normalizeText(text)}`;
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function parseReminderMessage(
  text: string,
  sourceChat: string | null = null,
  reference: Date = new Date(),
): ReminderDraft | null {
  const message = text.trim();
  const hasIntent =
    REMINDER_INTENT.test(message) ||
    (EVENT_CONTEXT.test(message) && DATE_CONTEXT.test(message));
  if (!message || !hasIntent) return null;

  const date = extractDate(message, reference);
  const timedDate = date ? applyTime(date, message) : null;
  const dueAt = timedDate?.toISOString() ?? null;
  const task = message
    .replace(REMINDER_PREFIX, "")
    .replace(/\b(?:tomorrow|today|next week)\b/i, "")
    .replace(/\bcoming\s+(?=(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b)/i, "")
    .replace(/\b(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, "")
    .replace(ISO_DATE_PATTERN, "")
    .replace(MONTH_DATE_PATTERN, "")
    .replace(TIME_PATTERN, "")
    .replace(/\b(?:by|on|at)\b/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,:-]+|[\s,:-]+$/g, "")
    .replace(/^to\s+/i, "")
    .trim();

  return {
    task: task || message,
    dueAt,
    sourceChat,
    duplicateKey: makeDuplicateKey(sourceChat, message),
  };
}

export function isReminderDuplicate(
  draft: Pick<ReminderDraft, "duplicateKey">,
  existingKeys: ReadonlySet<string>,
): boolean {
  return existingKeys.has(draft.duplicateKey);
}
