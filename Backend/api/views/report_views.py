from datetime import datetime, timedelta
from django.db.models import Count, Q
from rest_framework.decorators import api_view
from rest_framework.response import Response

from api.models import Document, DocumentType, AuditLog, WorkflowInstance


def _iso(dt):
    return dt.isoformat() + 'Z' if dt else None


@api_view(['GET'])
def summary(request):
    try:
        total = Document.objects.filter(is_deleted=False).count()
        approved = Document.objects.filter(
            status__in=['Approved', 'Released'], is_deleted=False
        ).count()
        in_review = Document.objects.filter(
            status__in=['In Check', 'In Review', 'In Approval'], is_deleted=False
        ).count()
        draft = Document.objects.filter(status='Draft', is_deleted=False).count()
        rejected = Document.objects.filter(status='Rejected', is_deleted=False).count()
        cutoff = datetime.utcnow() + timedelta(days=90)
        expiring = Document.objects.filter(
            expiry_date__isnull=False,
            expiry_date__lte=cutoff,
            expiry_date__gte=datetime.utcnow(),
            is_deleted=False,
        ).count()
        pending_wf = WorkflowInstance.objects.filter(completed=False).count()
        return Response({
            'total_documents': total,
            'approved': approved,
            'under_review': in_review,
            'draft': draft,
            'rejected': rejected,
            'expiring_90_days': expiring,
            'pending_workflow': pending_wf,
        })
    except Exception:
        return Response({
            'total_documents': 0, 'approved': 0, 'under_review': 0,
            'draft': 0, 'rejected': 0, 'expiring_90_days': 0, 'pending_workflow': 0,
        })


@api_view(['GET'])
def by_status(request):
    try:
        rows = Document.objects.filter(is_deleted=False).values('status').annotate(count=Count('id'))
        merged = {}
        for r in rows:
            label = 'Draft' if r['status'] in ('Draft', 'Created') else r['status']
            merged[label] = merged.get(label, 0) + r['count']
        return Response([{'status': k, 'count': v} for k, v in merged.items()])
    except Exception:
        return Response([])


@api_view(['GET'])
def by_type(request):
    try:
        rows = (
            DocumentType.objects.annotate(
                count=Count('document', filter=Q(document__is_deleted=False))
            ).values('name', 'count')
        )
        return Response([{'type': r['name'], 'count': r['count']} for r in rows])
    except Exception:
        return Response([])


@api_view(['GET'])
def by_type_status(request):
    try:
        rows = (
            Document.objects.filter(is_deleted=False, doc_type__isnull=False)
            .values('doc_type__name', 'status')
            .annotate(count=Count('id'))
        )
        pivot = {}
        statuses = set()
        for row in rows:
            doc_type = row['doc_type__name']
            status = 'Draft' if row['status'] in ('Draft', 'Created') else row['status']
            count = row['count']
            statuses.add(status)
            if doc_type not in pivot:
                pivot[doc_type] = {'type': doc_type}
            pivot[doc_type][status] = pivot[doc_type].get(status, 0) + count
        return Response({'data': list(pivot.values()), 'statuses': sorted(statuses)})
    except Exception:
        return Response({'data': [], 'statuses': []})


@api_view(['GET'])
def expiring(request):
    try:
        days = int(request.query_params.get('days', 90))
        cutoff = datetime.utcnow() + timedelta(days=days)
        docs = Document.objects.filter(
            expiry_date__isnull=False,
            expiry_date__lte=cutoff,
            expiry_date__gte=datetime.utcnow(),
            is_deleted=False,
        )
        return Response([
            {
                'id': d.id, 'doc_number': d.doc_number, 'title': d.title,
                'expiry_date': _iso(d.expiry_date), 'status': d.status, 'project': d.project,
            }
            for d in docs
        ])
    except Exception:
        return Response([])


@api_view(['GET'])
def audit(request):
    try:
        doc_id = request.query_params.get('doc_id')
        user_id = request.query_params.get('user_id')
        action = request.query_params.get('action')
        date_from = request.query_params.get('date_from')
        date_to = request.query_params.get('date_to')
        doc_type_id = request.query_params.get('doc_type_id')
        doc_number = request.query_params.get('doc_number')
        user_name = request.query_params.get('user_name')
        skip = int(request.query_params.get('skip', 0))
        limit = int(request.query_params.get('limit', 200))

        q = AuditLog.objects.select_related('user', 'document')
        if doc_id:
            q = q.filter(document_id=int(doc_id))
        if user_id:
            q = q.filter(user_id=int(user_id))
        if action:
            q = q.filter(action__icontains=action)
        if date_from:
            q = q.filter(timestamp__gte=datetime.fromisoformat(date_from))
        if date_to:
            q = q.filter(timestamp__lte=datetime.fromisoformat(date_to))
        if doc_type_id:
            q = q.filter(document__doc_type_id=int(doc_type_id))
        if doc_number:
            q = q.filter(document__doc_number__icontains=doc_number)
        if user_name:
            q = q.filter(user__name__icontains=user_name)

        logs = q.order_by('-timestamp')[skip:skip + limit]
        return Response([
            {
                'id': l.id, 'action': l.action, 'note': l.note,
                'timestamp': _iso(l.timestamp),
                'user': {'id': l.user.id, 'name': l.user.name} if l.user else None,
                'document': {
                    'id': l.document.id,
                    'doc_number': l.document.doc_number,
                    'title': l.document.title,
                } if l.document else None,
            }
            for l in logs
        ])
    except Exception:
        return Response([])
