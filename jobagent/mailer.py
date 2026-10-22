"""Send emails through Gmail SMTP with the resume attached."""
import mimetypes
import smtplib
from email.message import EmailMessage
from email.utils import make_msgid
from pathlib import Path


class Mailer:
    def __init__(self, address: str, app_password: str, resume_path: str):
        if not address or not app_password:
            raise RuntimeError("Set GMAIL_ADDRESS and GMAIL_APP_PASSWORD in .env")
        self.address, self.password = address, app_password.replace(" ", "")
        self.resume = Path(resume_path)
        if not self.resume.exists():
            raise RuntimeError(f"Resume not found at {self.resume}")
        self.smtp = None

    def _connect(self) -> None:
        self.smtp = smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=60)
        self.smtp.login(self.address, self.password)

    def __enter__(self):
        self._connect()
        return self

    def __exit__(self, *exc):
        if self.smtp:
            try:
                self.smtp.quit()
            except smtplib.SMTPException:
                pass

    def _alive(self) -> bool:
        try:
            return self.smtp.noop()[0] == 250
        except (smtplib.SMTPException, OSError):
            return False

    def send(self, to: str, subject: str, body: str, reply_to_id: str = "") -> str:
        """Send with the resume attached; returns the Message-ID. reply_to_id threads a follow-up."""
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.address, to, subject
        msg["Message-ID"] = make_msgid(domain=self.address.split("@")[-1])
        if reply_to_id:
            msg["In-Reply-To"] = msg["References"] = reply_to_id
        msg.set_content(body)
        ctype = mimetypes.guess_type(self.resume.name)[0] or "application/octet-stream"
        maintype, subtype = ctype.split("/", 1)
        msg.add_attachment(self.resume.read_bytes(), maintype=maintype, subtype=subtype,
                           filename=self.resume.name)
        # Gmail closes idle connections, e.g. during a long gap between emails: reconnect first
        if not self._alive():
            self._connect()
        try:
            self.smtp.send_message(msg)
        except smtplib.SMTPServerDisconnected:
            self._connect()
            self.smtp.send_message(msg)
        return msg["Message-ID"]
