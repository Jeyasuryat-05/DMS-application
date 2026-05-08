from django.db import migrations
from collections import defaultdict


def fix_doc_numbers(apps, schema_editor):
    Document = apps.get_model('api', 'Document')
    DocumentType = apps.get_model('api', 'DocumentType')

    type_code_map = {dt.id: (dt.code or 'DOC').strip() for dt in DocumentType.objects.all()}

    docs = Document.objects.order_by('doc_type_id', 'project', 'usi_kks_code', 'created_at', 'id')

    counters = defaultdict(int)
    updates = []

    for doc in docs:
        cm = doc.custom_metadata or {}

        # Resolve project: prefer project_station_unit from metadata
        proj = (
            cm.get('project_station_unit') or
            cm.get('project') or
            doc.project or
            'PROJ'
        )
        proj = str(proj).strip() or 'PROJ'

        # Resolve USI: prefer metadata usi key
        usi = (
            cm.get('usi') or
            cm.get('usi_kks_code') or
            doc.usi_kks_code or
            'USI'
        )
        usi = str(usi).strip() or 'USI'

        type_code = type_code_map.get(doc.doc_type_id, 'DOC')

        key = (type_code, proj, usi)
        counters[key] += 1
        seq = counters[key]

        new_number = f'{type_code}/{proj}/{usi}/{str(seq).zfill(4)}'

        doc.project      = proj
        doc.usi_kks_code = usi
        doc.doc_number   = new_number
        doc.serial_no    = new_number
        updates.append(doc)

    batch = 200
    for i in range(0, len(updates), batch):
        Document.objects.bulk_update(updates[i:i+batch], ['project', 'usi_kks_code', 'doc_number', 'serial_no'])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0003_reformat_doc_numbers'),
    ]

    operations = [
        migrations.RunPython(fix_doc_numbers, migrations.RunPython.noop),
    ]
