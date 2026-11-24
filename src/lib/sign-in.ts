import type { ComputerHelpRef } from "../../shared/wire";
import { api } from "@/state/store";

export async function answerSignIn(ref: Pick<ComputerHelpRef, "botId" | "threadId" | "messageId" | "place">, answer: "done" | "cancel"): Promise<void> {
  await api(`/api/bots/${encodeURIComponent(ref.botId)}/sign-in-cards/${encodeURIComponent(ref.messageId)}/${answer}`, {
    method: "POST",
    body: JSON.stringify({ threadId: ref.threadId }),
  });
  if (ref.place === "vm" || ref.place === "cloud") void window.ogb?.desktopViewer?.close(ref.botId).catch(() => false);
}

export function signInHostIsHere(): boolean {
  return Boolean(window.ogb) && window.ogb?.remoteClient?.active !== true;
}

export async function cardHasSavedLogin(ref: Pick<ComputerHelpRef, "botId" | "threadId" | "messageId">): Promise<boolean> {
  const body = await api(`/api/bots/${encodeURIComponent(ref.botId)}/sign-in-cards/${encodeURIComponent(ref.messageId)}/fill-login?threadId=${encodeURIComponent(ref.threadId)}`) as { hasSavedLogin?: boolean };
  return body.hasSavedLogin === true;
}

/** The server fills the saved login in the in-app browser; the password never enters the chat. */
export async function fillSavedLogin(ref: Pick<ComputerHelpRef, "botId" | "threadId" | "messageId">): Promise<void> {
  const body = await api(`/api/bots/${encodeURIComponent(ref.botId)}/sign-in-cards/${encodeURIComponent(ref.messageId)}/fill-login`, {
    method: "POST",
    body: JSON.stringify({ threadId: ref.threadId }),
  }) as { ok?: boolean; text?: string; error?: string };
  if (body && body.ok === false) {
    throw new Error(typeof body.text === "string" && body.text ? body.text : (typeof body.error === "string" && body.error ? body.error : "Could not fill the saved login."));
  }
}
