import { describe, expect, it } from "vitest";
import {
  isReminderDuplicate,
  parseReminderMessage,
} from "../src/services/messageParser";

describe("parseReminderMessage", () => {
  const reference = new Date(2026, 9, 29, 12, 0, 0);

  it("extracts a relative date, time, and task", () => {
    const result = parseReminderMessage(
      "Remind me tomorrow at 9 AM to submit the assignment",
      "Study group",
      reference,
    );

    expect(result?.task).toBe("submit the assignment");
    expect(result?.dueAt).toBe(new Date(2026, 9, 30, 9).toISOString());
    expect(result?.sourceChat).toBe("Study group");
  });

  it("extracts a weekday and 12-hour time", () => {
    const result = parseReminderMessage(
      "Call me at 5 PM on Friday",
      null,
      reference,
    );

    expect(result?.task).toBe("Call me");
    expect(result?.dueAt).toBe(new Date(2026, 9, 30, 17).toISOString());
  });

  it("leaves missing dates for user confirmation", () => {
    const result = parseReminderMessage(
      "Remind me to email Alex",
      null,
      reference,
    );

    expect(result?.task).toBe("email Alex");
    expect(result?.dueAt).toBeNull();
  });

  it("schedules a date-only reminder for 9 AM local time but leaves vague dates unconfirmed", () => {
    const dateOnly = parseReminderMessage(
      "Submit the assignment by Friday",
      null,
      reference,
    );
    const vague = parseReminderMessage(
      "Pay the bill next week",
      null,
      reference,
    );

    expect(dateOnly?.dueAt).toBe(new Date(2026, 9, 30, 9).toISOString());
    expect(vague?.dueAt).toBeNull();
  });

  it("ignores messages without reminder intent", () => {
    expect(parseReminderMessage("That sounds good for tomorrow")).toBeNull();
  });

  it("recognizes dated exam and appointment messages", () => {
    const exam = parseReminderMessage(
      "hi we have an exam tomorrow",
      "Study group",
      reference,
    );
    const appointment = parseReminderMessage(
      "you have a date tomorrow with Rania",
      "Friends",
      reference,
    );

    expect(exam?.task).toBe("hi we have an exam");
    expect(exam?.dueAt).toBe(new Date(2026, 9, 30, 9).toISOString());
    expect(appointment?.task).toBe("you have a date with Rania");
    expect(appointment?.dueAt).toBe(new Date(2026, 9, 30, 9).toISOString());
  });

  it("recognizes a meeting with a coming weekday and explicit time", () => {
    const result = parseReminderMessage(
      "Hello this is dinesh. We can meet on coming Friday at 2 pm to discuss project.",
      "Dinesh",
      reference,
    );

    expect(result?.task).toBe("Hello this is dinesh. We can meet to discuss project.");
    expect(result?.dueAt).toBe(new Date(2026, 9, 30, 14).toISOString());
  });
});

describe("duplicate detection", () => {
  it("detects repeated message keys", () => {
    const first = parseReminderMessage("Pay the bill next week", "Family");
    const repeat = parseReminderMessage("Pay the bill next week", "Family");

    expect(first).not.toBeNull();
    expect(repeat).not.toBeNull();
    expect(
      isReminderDuplicate(first!, new Set([repeat!.duplicateKey])),
    ).toBe(true);
    expect(
      isReminderDuplicate(first!, new Set(["different-key"])),
    ).toBe(false);
  });
});
