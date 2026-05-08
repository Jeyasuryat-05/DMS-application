from django.db import migrations
from collections import defaultdict


def reformat_doc_numbers(apps, schema_editor):
    Document = apps.get_model('api', 'Document')
    DocumentType = apps.get_model('api', 'DocumentType')

    type_code_map = {dt.id: (dt.code or 'DOC').strip() for dt in DocumentType.objects.all()}

    # Group docs by (type_code, project, usi) ordered by created_at for stable serial assignment
    docs = Document.objects.select_related().order_by('doc_type_id', 'project', 'usi_kks_code', 'created_at', 'id')

    counters = defaultdict(int)
    updates = []

    for doc in docs:
        type_code = type_code_map.get(doc.doc_type_id, 'DOC')
        proj_code = (doc.project or 'PROJ').strip()
        usi_code  = (doc.usi_kks_code or 'USI').strip()

        key = (type_code, proj_code, usi_code)
        counters[key] += 1
        seq = counters[key]

        doc.doc_number = f'{type_code}/{proj_code}/{usi_code}/{str(seq).zfill(4)}'
        doc.serial_no  = doc.doc_number
        updates.append(doc)

    # Bulk update in batches
    batch = 200
    for i in range(0, len(updates), batch):
        Document.objects.bulk_update(updates[i:i+batch], ['doc_number', 'serial_no'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0002_update_number_patterns'),
    ]

    operations = [
        migrations.RunPython(reformat_doc_numbers, migrations.RunPython.noop),
    ]
