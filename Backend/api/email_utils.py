"""
DMS Email Notifications
Sends HTML emails for workflow events. All sends are fire-and-forget (errors are logged, never raised).
"""
import logging
import threading
from html import escape as _esc
from django.core.mail import EmailMultiAlternatives
from django.conf import settings

logger = logging.getLogger('api')

FRONTEND_URL = getattr(settings, 'FRONTEND_URL', 'http://localhost:3000')


# ─── Base HTML shell ──────────────────────────────────────────────────────────

def _html(title, body_html, doc_number='', doc_title='', doc_url=''):
    # Escape all caller-supplied strings that end up inside HTML attributes or text
    safe_title = _esc(title or '')
    safe_doc_number = _esc(doc_number or '')
    safe_doc_title = _esc(doc_title or '')
    # doc_url is always generated internally via _doc_url() — only allow http(s)
    safe_doc_url = doc_url if (doc_url or '').lower().startswith(('http://', 'https://')) else ''

    action_btn = ''
    if safe_doc_url:
        action_btn = f'''
        <div style="text-align:center;margin:28px 0 8px;">
          <a href="{safe_doc_url}" style="background:#0C447C;color:#fff;padding:12px 32px;
             border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;
             display:inline-block;">Open Document</a>
        </div>'''

    doc_info = ''
    if safe_doc_number or safe_doc_title:
        doc_info = f'''
        <div style="background:#f0f7ff;border:1px solid #bfdbfe;border-radius:8px;
             padding:12px 16px;margin:18px 0;font-size:13px;">
          {'<div style="color:#6b7280;font-size:11px;margin-bottom:2px;">Document Number</div>'
           '<div style="font-weight:700;color:#0C447C;font-size:15px;">' + safe_doc_number + '</div>'
           if safe_doc_number else ''}
          {'<div style="color:#374151;margin-top:6px;">' + safe_doc_title + '</div>'
           if safe_doc_title else ''}
        </div>'''

    return f"""<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr><td style="background:#0C447C;padding:24px 32px;border-radius:12px 12px 0 0;">
          <div style="color:#fff;font-size:20px;font-weight:700;">Document Management System</div>
          <div style="color:rgba(255,255,255,0.7);font-size:12px;margin-top:4px;">Automated Notification</div>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#fff;padding:28px 32px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
          <div style="font-size:18px;font-weight:700;color:#111;margin-bottom:16px;">{safe_title}</div>
          {doc_info}
          {body_html}
          {action_btn}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:16px 32px;border:1px solid #e5e7eb;
             border-top:none;border-radius:0 0 12px 12px;text-align:center;">
          <div style="font-size:11px;color:#9ca3af;">
            This is an automated message from the DMS. Do not reply to this email.
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


# ─── Async send helper ────────────────────────────────────────────────────────

# Set to True inside management commands so emails send synchronously
# (daemon threads are killed when the process exits, so threads don't work there)
SYNC_MODE = False


def _do_send(to_emails, subject, html):
    """Core send — always runs synchronously."""
    try:
        msg = EmailMultiAlternatives(
            subject=subject,
            body=subject,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=to_emails,
        )
        msg.attach_alternative(html, 'text/html')
        msg.send(fail_silently=False)
        logger.info('Email sent to %s | %s', to_emails, subject)
    except Exception as exc:
        logger.warning('Email send failed: %s', exc)


def _send(to_emails, subject, html):
    """Send email — threaded during web requests, synchronous in management commands."""
    if not to_emails:
        return
    if not getattr(settings, 'EMAIL_HOST_USER', ''):
        logger.warning('EMAIL_HOST_USER not set — skipping email to %s', to_emails)
        return

    if SYNC_MODE:
        _do_send(to_emails, subject, html)
    else:
        threading.Thread(target=_do_send, args=(to_emails, subject, html), daemon=True).start()


def _doc_url(doc_id):
    return f'{FRONTEND_URL}/documents/{doc_id}'


def _emails(users):
    """Extract non-empty email addresses from a list of user objects or dicts."""
    out = []
    for u in users:
        email = getattr(u, 'email', None) or (u.get('email') if isinstance(u, dict) else None)
        if email:
            out.append(email)
    return out


# ─── Notification functions ───────────────────────────────────────────────────

def notify_workflow_assigned(doc, level_name, assignees, initiator_name):
    """
    Sent to new assignees when a workflow is initiated or advances to their level.
    """
    if not assignees:
        return
    to = _emails(assignees)
    if not to:
        return

    s_initiator = _esc(initiator_name or '')
    s_level = _esc(level_name or '')

    body = f"""
    <p style="font-size:14px;color:#374151;line-height:1.6;">
      Hello,<br><br>
      <strong>{s_initiator}</strong> has assigned you as a reviewer for the
      <strong>{s_level}</strong> stage of the following document.
      Please log in to review and take action.
    </p>
    <table style="font-size:13px;color:#374151;width:100%;margin:12px 0;">
      <tr><td style="padding:4px 0;color:#6b7280;width:130px;">Stage:</td>
          <td><strong>{s_level}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">Initiated by:</td>
          <td>{s_initiator}</td></tr>
    </table>
    <p style="font-size:12px;color:#6b7280;">
      Action required: review the document and <strong>Approve</strong> or <strong>Reject</strong>.
    </p>"""

    html = _html(
        title=f'Action Required: {level_name} — Approval Request',
        body_html=body,
        doc_number=doc.doc_number or '',
        doc_title=doc.title or '',
        doc_url=_doc_url(doc.id),
    )
    _send(to, f'[DMS] Action Required: {doc.doc_number} — {level_name}', html)


def notify_approved(doc, approved_by_name, next_level_name, next_assignees):
    """
    Sent to next-level assignees when the previous level is fully approved.
    """
    if not next_assignees:
        return
    to = _emails(next_assignees)
    if not to:
        return

    s_approved_by = _esc(approved_by_name or '')
    s_next_level = _esc(next_level_name or '')

    body = f"""
    <p style="font-size:14px;color:#374151;line-height:1.6;">
      Hello,<br><br>
      The <strong>{s_next_level}</strong> stage of the document below is now ready for your review.
      The previous stage was approved by <strong>{s_approved_by}</strong>.
    </p>
    <table style="font-size:13px;color:#374151;width:100%;margin:12px 0;">
      <tr><td style="padding:4px 0;color:#6b7280;width:130px;">Your Stage:</td>
          <td><strong>{s_next_level}</strong></td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">Approved by:</td>
          <td>{s_approved_by}</td></tr>
    </table>"""

    html = _html(
        title=f'Action Required: {next_level_name} — Awaiting Your Approval',
        body_html=body,
        doc_number=doc.doc_number or '',
        doc_title=doc.title or '',
        doc_url=_doc_url(doc.id),
    )
    _send(to, f'[DMS] Action Required: {doc.doc_number} — {next_level_name}', html)


def notify_released(doc, released_by_name, creator):
    """
    Sent to the document creator when the document is fully approved and released.
    """
    to = _emails([creator]) if creator else []
    if not to:
        return

    s_released_by = _esc(released_by_name or '')

    body = f"""
    <p style="font-size:14px;color:#374151;line-height:1.6;">
      Congratulations! Your document has successfully completed the approval workflow
      and has been <strong style="color:#0F6E56;">Released</strong>.
    </p>
    <table style="font-size:13px;color:#374151;width:100%;margin:12px 0;">
      <tr><td style="padding:4px 0;color:#6b7280;width:130px;">Released by:</td>
          <td>{s_released_by}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">Status:</td>
          <td><strong style="color:#0F6E56;">Released</strong></td></tr>
    </table>"""

    html = _html(
        title='Document Released',
        body_html=body,
        doc_number=doc.doc_number or '',
        doc_title=doc.title or '',
        doc_url=_doc_url(doc.id),
    )
    _send(to, f'[DMS] Document Released: {doc.doc_number}', html)


def notify_rejected(doc, rejected_by_name, level_name, note, creator):
    """
    Sent to the document creator when a workflow step is rejected.
    """
    to = _emails([creator]) if creator else []
    if not to:
        return

    s_rejected_by = _esc(rejected_by_name or '')
    s_level = _esc(level_name or '')
    s_note = _esc(note or '')

    note_row = f"""
    <tr><td style="padding:4px 0;color:#6b7280;vertical-align:top;width:130px;">Reason:</td>
        <td style="color:#A32D2D;">{s_note or 'No reason provided'}</td></tr>""" if note else ''

    body = f"""
    <p style="font-size:14px;color:#374151;line-height:1.6;">
      Your document has been <strong style="color:#A32D2D;">Rejected</strong> at the
      <strong>{s_level}</strong> stage. It has been returned to <strong>Draft</strong> status.
      Please review the feedback, make the necessary corrections, and re-initiate the workflow.
    </p>
    <table style="font-size:13px;color:#374151;width:100%;margin:12px 0;">
      <tr><td style="padding:4px 0;color:#6b7280;width:130px;">Rejected by:</td>
          <td>{s_rejected_by}</td></tr>
      <tr><td style="padding:4px 0;color:#6b7280;">Stage:</td>
          <td>{s_level}</td></tr>
      {note_row}
    </table>"""

    html = _html(
        title='Document Rejected — Returned to Draft',
        body_html=body,
        doc_number=doc.doc_number or '',
        doc_title=doc.title or '',
        doc_url=_doc_url(doc.id),
    )
    _send(to, f'[DMS] Document Rejected: {doc.doc_number}', html)


def notify_returned(doc, returned_by_name, note, creator):
    """
    Sent to the document creator when a reviewer returns the document for correction.
    """
    to = _emails([creator]) if creator else []
    if not to:
        return

    s_returned_by = _esc(returned_by_name or '')
    s_note = _esc(note or '')

    body = f"""
    <p style="font-size:14px;color:#374151;line-height:1.6;">
      Your document has been <strong>returned for correction</strong> by
      <strong>{s_returned_by}</strong>. It is now back in <strong>Draft</strong> status.
      Please review the comments, make the necessary corrections, and re-initiate the workflow.
    </p>
    <table style="font-size:13px;color:#374151;width:100%;margin:12px 0;">
      <tr><td style="padding:4px 0;color:#6b7280;width:130px;">Returned by:</td>
          <td>{s_returned_by}</td></tr>
      {'<tr><td style="padding:4px 0;color:#6b7280;vertical-align:top;">Note:</td><td>' + s_note + '</td></tr>' if note else ''}
    </table>"""

    html = _html(
        title='Document Returned for Correction',
        body_html=body,
        doc_number=doc.doc_number or '',
        doc_title=doc.title or '',
        doc_url=_doc_url(doc.id),
    )
    _send(to, f'[DMS] Document Returned: {doc.doc_number}', html)


def notify_feedback_requested(doc, requester_name, comment, tagged_user):
    """
    Sent to the tagged user when someone requests their feedback on a document.
    """
    to = _emails([tagged_user]) if tagged_user else []
    if not to:
        return

    s_requester = _esc(requester_name or '')
    s_comment = _esc(comment or '')

    body = f"""
    <p style="font-size:14px;color:#374151;line-height:1.6;">
      <strong>{s_requester}</strong> has requested your feedback on the following document.
    </p>
    <div style="background:#f8fafc;border-left:4px solid #185FA5;padding:12px 16px;
         border-radius:0 8px 8px 0;margin:16px 0;font-size:13px;color:#374151;font-style:italic;">
      &#8220;{s_comment}&#8221;
    </div>
    <p style="font-size:12px;color:#6b7280;">
      Please open the document and add your feedback in the Feedback tab.
    </p>"""

    html = _html(
        title='Feedback Requested',
        body_html=body,
        doc_number=doc.doc_number or '',
        doc_title=doc.title or '',
        doc_url=_doc_url(doc.id),
    )
    _send(to, f'[DMS] Feedback Requested on {doc.doc_number}', html)


def notify_feedback_added(doc, commenter_name, comment, creator):
    """
    Sent to the document creator/owner when someone adds a feedback comment.
    """
    to = _emails([creator]) if creator else []
    if not to:
        return

    s_commenter = _esc(commenter_name or '')
    s_comment = _esc(comment or '')

    body = f"""
    <p style="font-size:14px;color:#374151;line-height:1.6;">
      <strong>{s_commenter}</strong> has added a feedback comment on your document.
    </p>
    <div style="background:#f8fafc;border-left:4px solid #7F77DD;padding:12px 16px;
         border-radius:0 8px 8px 0;margin:16px 0;font-size:13px;color:#374151;font-style:italic;">
      &#8220;{s_comment}&#8221;
    </div>"""

    html = _html(
        title='New Feedback on Your Document',
        body_html=body,
        doc_number=doc.doc_number or '',
        doc_title=doc.title or '',
        doc_url=_doc_url(doc.id),
    )
    _send(to, f'[DMS] New Feedback: {doc.doc_number}', html)
