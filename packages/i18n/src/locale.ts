import { enMessages, type MessageKey, viMessages } from "./messages.js";

export const LOCALES = ["vi", "en"] as const;

export type Locale = (typeof LOCALES)[number];

const messages: Readonly<Record<Locale, Readonly<Record<MessageKey, string>>>> = {
  vi: viMessages,
  en: enMessages,
};

export function normalizeLocale(value: string | null | undefined): Locale {
  const language = value?.trim().toLowerCase().split("-")[0];

  return language === "en" ? "en" : "vi";
}

export function getMessage(locale: Locale, key: MessageKey): string {
  return messages[locale][key];
}
