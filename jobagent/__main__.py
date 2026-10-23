"""Job agent CLI.

  python -m jobagent find      search jobs, filter and score them, add to sheet, draft emails
  python -m jobagent send      check replies, send approved emails (all drafts if email.auto_send) and follow-ups
  python -m jobagent run       find, then send (used by the daily schedule)
  python -m jobagent recheck   apply the current filters to jobs already in the sheet
  python -m jobagent status    show counts per status
  python -m jobagent ui        start the dashboard at http://localhost:8765
"""
import logging
from logging.handlers import RotatingFileHandler
import sys
import time
from collections import Counter
from datetime import datetime, timedelta

from .activity import friendly_error, record, running, set_progress, wait_between
from .config import ROOT, load_config, server_settings
from .finder import find_jobs
from .hr import HRSheet, send_hr
from .inbox import check_inbox
from .lock import agent_lock
from .mailer import Mailer
from .matcher import reject_reason, score
from .sheet import MAX_CELL, SheetOpen, Tracker, first_email, open_in_spreadsheet, same_job_key
from .writer import EmailWriter, follow_up_email

log = logging.getLogger("jobagent")


def _who(row: dict) -> str:
    """Company name, or the poster's name for LinkedIn posts."""
    if row.get("Source") == "LinkedIn post":
        return str(row.get("Notes") or "").split(" · ")[0].removeprefix("LinkedIn post by ").strip() or "a recruiter"
    return row.get("Company") or "a company"


def _now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def cmd_find(cfg: dict) -> str:
    with agent_lock():
        return _find(cfg)


def _find(cfg: dict) -> str:
    tracker = Tracker(cfg["sheet_path"])
    writer = EmailWriter(cfg)
    search, experience = cfg["search"], int(cfg["candidate"].get("experience_years") or 0)
    jobs = find_jobs(cfg, set(tracker._links))
    contacting = tracker.contacting()
    same_jobs = tracker.same_job_keys()
    added = drafted = filtered = 0
    reasons = Counter()
    for job in jobs:
        if tracker.has(job["Job Link"]):
            # Jobs saved before the Full JD column existed get their description filled in
            row_num = tracker.row_of(job["Job Link"])
            if job["Description"] and not tracker.ws.cell(row=row_num, column=tracker.col["Full JD"] + 1).value:
                tracker.update(row_num, **{"Full JD": job["Description"][:MAX_CELL]})
            continue
        key = same_job_key(job)
        if key[0] and key in same_jobs:
            continue   # same company + title already saved from another site or a repost
        reason = reject_reason(job, search, experience)
        if reason:
            filtered += 1
            reasons[reason.split(" (")[0] if reason.startswith(("needs", "location", "too senior")) else reason] += 1
            continue
        pct, skills = score(job, search)
        # LinkedIn posts are short, so a single matching primary skill is enough to keep one
        is_post = job["Source"] == "LinkedIn post"
        if pct < search["min_match_percent"] and not (is_post and pct > 0):
            filtered += 1
            reasons[f"match below {search['min_match_percent']}%"] += 1
            continue
        job["Match %"] = pct
        job["Tech Stack"] = ", ".join(skills)
        job["Profile / JD Summary"] = " ".join(job["Description"].split())[:400]
        job["Full JD"] = job["Description"][:MAX_CELL]
        if not job.get("Company"):
            job["Company"] = "LinkedIn post" if is_post else "Unknown"
        email = first_email(job["Recruiter Email"])
        if email and email in contacting:
            # One conversation per recruiter: don't draft a second email to the same person
            job["Status"] = "Skipped"
            job["Notes"] = f"{job.get('Notes', '')} · Same recruiter as row {contacting[email]}".lstrip(" ·")
        elif email:
            job["Email Subject"], job["Email Body"] = writer.draft(job, skills)
            job["Status"] = "Drafted"
            contacting[email] = tracker.ws.max_row + 1
            drafted += 1
        else:
            job["Status"] = "No Contact"   # apply via the Job Link
        tracker.add(job)
        same_jobs.add(key)
        added += 1
    tracker.save(force=True)   # no emails sent here, so a stale open copy can only drop new finds
    msg = f"Fetched {len(jobs)} jobs, filtered out {filtered}, added {added} new matches, drafted {drafted} emails"
    log.info(msg)
    title = f"Found {added} new job{'s' if added != 1 else ''}" if added else "No new jobs this time"
    detail = f"Checked {len(jobs)} listings · {filtered} didn't fit your filters"
    if reasons:
        detail += " (" + ", ".join(f"{n} {r}" for r, n in reasons.most_common(3)) + ")"
    if drafted:
        detail += f" · {drafted} email{'s' if drafted != 1 else ''} drafted for your review"
    record("search", title, detail)
    return f"{title}. {detail}."


def cmd_send(cfg: dict) -> str:
    with agent_lock("send", wait=0):   # one send run at a time
        return _send(cfg)


def _update_from_inbox(cfg: dict) -> tuple[str, bool]:
    """Mark job rows Replied or Failed (bounced) from Gmail. Never fatal: sending goes on without it.
    Gmail is read without holding the sheet lock, so the dashboard stays usable meanwhile.
    Returns (note, ok); ok is False if replies couldn't be checked or recorded (follow-ups must wait)."""
    with agent_lock("jobs"):
        contacts = {first_email(r["Recruiter Email"]): str(r["Email Sent On"])
                    for _, r in Tracker(cfg["sheet_path"]).rows("Emailed") if r["Email Sent On"]}
    if not contacts:
        return "", True
    env = cfg["env"]
    try:
        replies, bounced = check_inbox(env["GMAIL_ADDRESS"], env["GMAIL_APP_PASSWORD"], contacts)
    except Exception as e:
        log.warning("Couldn't check Gmail for replies: %s", e)
        record("problem", "Couldn't check Gmail for replies", friendly_error(e))
        return "", False
    if not (replies or bounced):
        return "", True
    with agent_lock("jobs"):
        tracker = Tracker(cfg["sheet_path"])
        if open_in_spreadsheet(tracker.path):
            record("problem", "Couldn't record replies", "Your jobs sheet is open in LibreOffice/Excel. Close it; follow-ups wait until then.")
            return "", False
        for row_num, r in tracker.rows("Emailed"):
            email = first_email(r["Recruiter Email"])
            if email in replies:
                tracker.update(row_num, Status="Replied", **{"Replied On": replies[email]})
                record("reply", f"{_who(r)} replied about {r['Role']}", f"Check your Gmail · {email}", row_num)
            elif email in bounced:
                tracker.update(row_num, Status="Failed", Notes=bounced[email])
                record("bounce", f"Email to {_who(r)} bounced", bounced[email].removeprefix("Bounced: ").capitalize(), row_num)
        tracker.save()
    log.info("Inbox: %d replies, %d bounced", len(replies), len(bounced))
    return (f"{len(replies)} new replies, " if replies else ""), True


def _send(cfg: dict) -> str:
    """Job emails first, then the HR outreach list; both share one daily limit."""
    inbox_note, replies_ok = _update_from_inbox(cfg)
    with agent_lock("jobs"):
        tracker = Tracker(cfg["sheet_path"])
        jobs_today = tracker.sent_today()
        emailed = {first_email(r["Recruiter Email"]) for _, r in tracker.rows() if r["Status"] in ("Emailed", "Replied")}
    with agent_lock("hr"):
        hr_sheet = HRSheet()
        hr_today = hr_sheet.sent_today()
        # Anyone already emailed from either list never gets a second first-contact email
        emailed |= {r["HR Email"].lower() for _, r in hr_sheet.rows() if r["Status"] in ("Emailed", "Replied")}
    remaining = cfg["email"]["daily_limit"] - jobs_today - hr_today

    sent, followed, skipped, remaining = _send_jobs(cfg, remaining, emailed, follow_ups=replies_ok)
    hr_sent, hr_followed = send_hr(cfg, remaining, emailed)
    set_progress("")
    if not (sent or followed or skipped or hr_sent or hr_followed):
        msg = f"{inbox_note}nothing to send (daily limit left: {max(remaining, 0)})".capitalize()
    else:
        msg = (f"{inbox_note}sent {sent + hr_sent} emails ({hr_sent} to your HR list) and {followed + hr_followed} follow-ups"
               + (f", skipped {skipped} duplicate recruiters" if skipped else "")).capitalize()
    log.info(msg)
    return msg


def _send_jobs(cfg: dict, remaining: int, emailed: set[str], follow_ups: bool = True) -> tuple[int, int, int, int]:
    env, ecfg = cfg["env"], cfg["email"]
    send_statuses = ("Approved", "Drafted") if ecfg["auto_send"] else ("Approved",)
    # Without knowing who replied, a follow-up could go to someone who already answered
    follow_days = int(ecfg.get("follow_up_days") or 0) if follow_ups else 0
    cutoff = (datetime.now() - timedelta(days=follow_days)).strftime("%Y-%m-%d %H:%M")
    with agent_lock("jobs"):
        tracker = Tracker(cfg["sheet_path"])
        queue = [("new", r["Job Link"]) for s in send_statuses for _, r in tracker.rows(s)]
        queue += [("follow-up", r["Job Link"]) for _, r in tracker.rows("Emailed")
                  if follow_days and not r["Follow-up Sent On"] and str(r["Email Sent On"] or "9") <= cutoff]
    sent = followed = skipped = 0
    if remaining <= 0 or not queue:
        return sent, followed, skipped, remaining
    total = min(len(queue), remaining)
    with Mailer(env["GMAIL_ADDRESS"], env["GMAIL_APP_PASSWORD"], cfg["candidate"]["resume_path"],
                cfg["candidate"]["name"]) as mailer:
        for i, (kind, link) in enumerate(queue):
            if remaining <= 0:
                break
            emailed_now = False
            with agent_lock("jobs"):
                # Re-read the row: you may have unapproved, skipped or edited it while earlier emails went out
                tracker = Tracker(cfg["sheet_path"])
                if open_in_spreadsheet(tracker.path):
                    # Without saving "Emailed" we'd email them again next time, so stop instead
                    record("problem", "Paused sending job emails", "Your jobs sheet is open in LibreOffice/Excel. Save and close it, then send again.")
                    break
                row_num = tracker.row_of(link)
                row = dict(tracker.rows()).get(row_num) if row_num else None
                if not row or (kind == "new" and row["Status"] not in send_statuses) \
                        or (kind == "follow-up" and (row["Status"] != "Emailed" or row["Follow-up Sent On"])):
                    continue
                to = first_email(row["Recruiter Email"])
                set_progress(f"Job emails: emailing {to} ({sent + followed + 1} of {total})")
                if kind == "new" and to in emailed:
                    tracker.update(row_num, Status="Skipped", Notes="Already emailed this recruiter")
                    tracker.save()
                    record("filter", f"Didn't email {_who(row)} again", f"You already emailed {to}", row_num)
                    skipped += 1
                    continue
                try:
                    if kind == "new":
                        msg_id = mailer.send(to, row["Email Subject"], row["Email Body"])
                        tracker.update(row_num, Status="Emailed", **{"Email Sent On": _now(), "Message ID": msg_id})
                        emailed.add(to)
                        sent += 1
                        record("email", f"Emailed {_who(row)} about {row['Role']}", f"To {to} · resume attached", row_num)
                    else:
                        subject, body = follow_up_email(row, cfg["candidate"])
                        mailer.send(to, subject, body, reply_to_id=row["Message ID"] or "")
                        tracker.update(row_num, **{"Follow-up Sent On": _now()})
                        followed += 1
                        record("followup", f"Followed up with {_who(row)}", f"No reply to your {row['Role']} email yet · {to}", row_num)
                    remaining -= 1
                except Exception as e:  # keep going; record the failure on the row
                    if kind == "new":
                        tracker.update(row_num, Status="Failed", Notes=friendly_error(e))
                    log.warning("Failed to send %s email to %s: %s", kind, to, e)
                    record("problem", f"Couldn't email {_who(row)}", friendly_error(e), row_num)
                try:
                    tracker.save()
                except SheetOpen:
                    # Opened mid-send: the email went out, so record it anyway and stop
                    tracker.save(force=True)
                    record("problem", "Paused sending job emails", "Your jobs sheet was opened in LibreOffice/Excel while sending. "
                           "Close it without saving (the agent updated it), then send again.")
                    break
                emailed_now = True
            if emailed_now and remaining > 0 and i < len(queue) - 1:
                wait_between(ecfg["delay_seconds"], f"Job emails: sent {sent + followed} of {total}")
    return sent, followed, skipped, remaining


def cmd_run(cfg: dict) -> str:
    record("schedule", "Daily run started", "Finding jobs, checking replies and sending approved emails")
    return f"{cmd_find(cfg)} {cmd_send(cfg)}"


def cmd_recheck(cfg: dict) -> str:
    """Skip jobs already in the sheet that the current filters would reject (reversible: Restore in the UI)."""
    with agent_lock():
        tracker = Tracker(cfg["sheet_path"])
        experience = int(cfg["candidate"].get("experience_years") or 0)
        skipped = 0
        for row_num, r in tracker.rows():
            if r["Status"] not in ("Drafted", "No Contact"):
                continue
            job = {"Role": r["Role"] or "", "Description": r["Full JD"] or r["Profile / JD Summary"] or "",
                   "Location": r["Location"] or ""}
            reason = reject_reason(job, cfg["search"], experience)
            if reason:
                tracker.update(row_num, Status="Skipped", Notes=f"Filtered: {reason}")
                skipped += 1
        tracker.save(force=True)
    msg = f"Re-checked saved jobs: {skipped} no longer match your filters"
    log.info(msg)
    record("filter", msg, "They're marked Skipped; use Restore on a job to bring it back" if skipped else "")
    return msg


def cmd_status(cfg: dict) -> None:
    tracker = Tracker(cfg["sheet_path"])
    counts = Counter(r["Status"] for _, r in tracker.rows())
    for status, n in counts.most_common():
        print(f"{status:12} {n}")
    print(f"Sent today: {tracker.sent_today()}/{cfg['email']['daily_limit']}")


def main() -> None:
    (ROOT / "logs").mkdir(exist_ok=True)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(), RotatingFileHandler(ROOT / "logs" / "agent.log", maxBytes=5_000_000, backupCount=3)],
    )
    cmd = sys.argv[1] if len(sys.argv) > 1 else "run"
    cfg = load_config()
    commands = {"find": cmd_find, "send": cmd_send, "run": cmd_run, "recheck": cmd_recheck, "status": cmd_status}
    if cmd in commands:
        try:
            if cmd == "status":
                commands[cmd](cfg)
            else:
                with running(cmd):
                    commands[cmd](cfg)
        except Exception as e:
            record("problem", "The scheduled run stopped early" if cmd == "run" else f"“{cmd}” stopped early", friendly_error(e))
            raise
    elif cmd == "ui":
        import uvicorn
        srv = server_settings()
        if srv["env"] == "prod" and len(srv["password"]) < 12:
            # Anyone who reaches the dashboard can send email as you, so never serve it publicly without a login
            raise SystemExit("JOBAGENT_ENV=prod needs JOBAGENT_PASSWORD (12+ characters) in .env")
        log.info("Dashboard (%s) on %s:%d, open %s", srv["env"], srv["host"], srv["port"], srv["public_url"])
        uvicorn.run("jobagent.api:app", host=srv["host"], port=srv["port"])
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
