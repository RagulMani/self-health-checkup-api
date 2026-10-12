/**
 * Platform-owned transactional email for auth flows — do NOT edit.
 *
 * Password-reset mail goes out through Resend when `RESEND_API_KEY` is set
 * (the platform syncs it when the workspace has Resend connected). Without a
 * key the message is logged so sandbox previews still show the link.
 */
import { env } from "../env";

export interface AuthMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendAuthEmail(mail: AuthMail): Promise<{ delivered: boolean }> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(
      `[auth/email] RESEND_API_KEY not set — not delivering. To: ${mail.to} Subject: ${mail.subject}\n${mail.text}`,
    );
    return { delivered: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.AUTH_EMAIL_FROM,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[auth/email] Resend responded ${res.status}: ${detail.slice(0, 300)}`);
    return { delivered: false };
  }
  return { delivered: true };
}
