"""Check Gmail (IMAP, same App Password) for recruiter replies and bounced emails."""
import email as email_lib
import imaplib
import logging
import re
from datetime import datetime
from email.utils import parsedate_to_datetime

log = logging.getLogger(__name__)


def _imap_date(sent_on: str) -> str:
    return datetime.strptime(sent_on[:10], "%Y-%m-%d").strftime("%d-%b-%Y")


AUTO_HEADERS = ("AUTO-SUBMITTED", "X-AUTOREPLY", "X-AUTORESPOND", "X-AUTO-RESPONSE-SUPPRESS", "PRECEDENCE", "SUBJECT")
AUTO_SUBJECT = re.compile(r"^\s*(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|ooo\b|away from|on leave|"
                          r"vacation|thank you for (your )?(email|mail|application|contacting)|we('ve| have) received)", re.I)


def is_auto_reply(h) -> bool:
    auto = (h.get("Auto-Submitted") or "no").strip().lower()
    return (auto != "no" or bool(h.get("X-Autoreply") or h.get("X-Autorespond"))
            or (h.get("Precedence") or "").strip().lower() in ("auto_reply", "bulk", "junk", "list")
            or bool(AUTO_SUBJECT.search(str(h.get("Subject") or ""))))


def bounce_reason(raw: bytes) -> str:
    """Plain-language reason from a Gmail delivery-failure notice."""
    text = ""
    for part in email_lib.message_from_bytes(raw).walk():
        if part.get_content_type() == "text/plain":
            text = part.get_payload(decode=True).decode(errors="ignore").lower()
            break
    if "too large" in text or "exceeds" in text and "size" in text or "5.3.4" in text:
        return "Bounced: their mailbox rejected the email size (your resume attachment is too big for it)"
    if "doesn't exist" in text or "does not exist" in text or "5.1.1" in text or "user unknown" in text or "no such user" in text:
        return "Bounced: this email address doesn't exist"
    if "mailbox full" in text or "quota" in text or "5.2.2" in text:
        return "Bounced: their mailbox is full"
    if "blocked" in text or "spam" in text or "policy" in text or "5.7." in text:
        return "Bounced: their mail server blocked the email"
    return "Bounced: the email couldn't be delivered"


def check_inbox(address: str, password: str, contacts: dict[str, str]) -> tuple[dict[str, str], dict[str, str]]:
    """contacts: recruiter email -> date first emailed ("YYYY-MM-DD ...").
    Returns ({email: reply date}, {email: bounce reason})."""
    replies, bounced = {}, {}
    if not contacts:
        return replies, bounced
    with imaplib.IMAP4_SSL("imap.gmail.com", 993, timeout=60) as imap:
        imap.login(address, password.replace(" ", ""))
        # All Mail also catches replies that were archived or labelled
        ok, _ = imap.select('"[Gmail]/All Mail"', readonly=True)
        if ok != "OK":
            imap.select("INBOX", readonly=True)
        for email, sent_on in contacts.items():
            if any(c in email for c in '"\\\r\n'):
                log.warning("Skipping reply check for odd address %r", email)
                continue   # can't be quoted safely in an IMAP SEARCH
            try:
                since = _imap_date(str(sent_on))
            except ValueError:
                log.warning("Skipping reply check for %s: unreadable sent date %r", email, sent_on)
                continue
            _, data = imap.search(None, "FROM", f'"{email}"', "SINCE", since)
            for msg_id in data[0].split():
                _, msg = imap.fetch(msg_id, f"(BODY.PEEK[HEADER.FIELDS ({' '.join(AUTO_HEADERS)} DATE)])")
                headers = email_lib.message_from_bytes(msg[0][1])
                if is_auto_reply(headers):
                    continue   # out-of-office etc. isn't a real reply; keep the follow-up
                try:
                    replies[email] = parsedate_to_datetime(headers["Date"]).strftime("%Y-%m-%d %H:%M")
                except (TypeError, ValueError):
                    replies[email] = datetime.now().strftime("%Y-%m-%d %H:%M")
                break
            if email in replies:
                continue
            _, data = imap.search(None, "FROM", '"mailer-daemon"', "SINCE", since, "BODY", f'"{email}"')
            for msg_id in data[0].split():
                _, msg = imap.fetch(msg_id, "(BODY.PEEK[])")
                raw = msg[0][1]
                # BODY search is a substring match: make sure the notice is about exactly this address
                if f" {email}" in raw.decode(errors="ignore").lower().replace("<", " ").replace("\n", " "):
                    bounced[email] = bounce_reason(raw)
                    break
    return replies, bounced
