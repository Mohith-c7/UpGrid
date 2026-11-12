export interface InviteMail { to: string; name: string | null; companyName: string; driveRole: string; inviteToken: string; expiresAt: Date; invitedBy: string }
export type InviteMailer = (mail: InviteMail) => Promise<boolean>;
let mailer: InviteMailer | null = null;
/** The mail module registers a sender here; without one invites are in-app/token only (emailSent:false). */
export function setInviteMailer(fn: InviteMailer | null) { mailer = fn; }
export async function sendInviteMail(mail: InviteMail): Promise<boolean> {
  if (!mailer) return false;
  try { return !!(await mailer(mail)); } catch { return false; }
}
