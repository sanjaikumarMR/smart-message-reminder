export interface VisibleMessage {
  element: HTMLElement;
  text: string;
  chatName: string | null;
}

const MESSAGE_SELECTOR =
  '[data-pre-plain-text], [data-id^="true_"], [data-id^="false_"]';

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  );
}

function isNearChatBottom(element: HTMLElement, main: HTMLElement): boolean {
  const messageRect = element.getBoundingClientRect();
  const mainRect = main.getBoundingClientRect();
  let parent = element.parentElement;
  while (parent && main.contains(parent)) {
    const style = window.getComputedStyle(parent);
    if (
      parent.scrollHeight > parent.clientHeight + 40 &&
      /(auto|scroll|hidden|overlay)/.test(style.overflowY)
    ) {
      return parent.scrollHeight - parent.clientHeight - parent.scrollTop < 160;
    }
    if (parent === main) break;
    parent = parent.parentElement;
  }
  return (
    messageRect.bottom >= mainRect.bottom - 220 &&
    messageRect.top < mainRect.bottom
  );
}

export function getCurrentChatName(): string | null {
  const main = document.querySelector("main");
  const headers = Array.from((main ?? document).querySelectorAll("header"))
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .filter(isVisible);
  const candidates = headers
    .flatMap((header) => header.innerText.split("\n"))
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 1 &&
        line.length < 100 &&
        !/^\d+$/.test(line) &&
        !/^(whatsapp|online|last seen|typing|click here|unread|today|yesterday)$/i.test(line),
    );
  return candidates.at(-1) ?? null;
}

export function getRenderedMessageElements(
  main: HTMLElement,
): HTMLElement[] {
  return Array.from(main.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR));
}

export function readVisibleMessage(element: HTMLElement): VisibleMessage | null {
  const main = element.closest("main");
  if (!main || !isVisible(element) || !isNearChatBottom(element, main)) {
    return null;
  }
  const text = element.innerText.trim();
  if (!text || text.length > 2000) return null;
  return { element, text, chatName: getCurrentChatName() };
}

export function getMessageElementsFromNode(node: Node): HTMLElement[] {
  const element =
    node instanceof HTMLElement ? node : node.parentElement;
  if (!element) return [];
  const matches = new Set<HTMLElement>();
  const closest = element.closest<HTMLElement>(MESSAGE_SELECTOR);
  if (closest) matches.add(closest);
  for (const child of element.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)) {
    matches.add(child);
  }
  return [...matches];
}
