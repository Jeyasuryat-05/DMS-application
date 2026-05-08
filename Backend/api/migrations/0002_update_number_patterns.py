from django.db import migrations


def update_number_patterns(apps, schema_editor):
    DocumentType = apps.get_model('api', 'DocumentType')
    DocumentType.objects.all().update(number_pattern='{TYPE}/{PROJECT}/{USI}/{SEQ}')


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(update_number_patterns, migrations.RunPython.noop),
    ]
