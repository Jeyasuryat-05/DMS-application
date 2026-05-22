import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0011_user_cadre_code_user_cadre_description_user_cmd_id_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='document',
            name='on_behalf_of',
            field=models.ForeignKey(
                blank=True, db_column='on_behalf_of_id', null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='behalf_docs', to='api.user',
            ),
        ),
        migrations.CreateModel(
            name='ApproverConfig',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('employee_number',          models.CharField(max_length=8)),
                ('process_id',               models.CharField(max_length=50)),
                ('approver_employee_number', models.CharField(max_length=8)),
                ('approver_employee_name',   models.CharField(max_length=100)),
                ('approver_email',           models.CharField(blank=True, default='', max_length=241)),
                ('approver_level',           models.IntegerField(default=1)),
                ('final_approver_flag',      models.CharField(default='N', max_length=1)),
                ('created_at',               models.DateTimeField(auto_now_add=True)),
                ('updated_at',               models.DateTimeField(auto_now=True)),
            ],
            options={
                'db_table': 'approver_configs',
                'ordering': ['employee_number', 'process_id', 'approver_level'],
            },
        ),
    ]
