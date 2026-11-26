from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('examination', '0062_landinghubsettings')]

    operations = [
        migrations.RemoveConstraint(model_name='roundresult', name='unique_round_occurrence_per_participation'),
        migrations.AddConstraint(
            model_name='roundresult',
            constraint=models.UniqueConstraint(
                fields=['participation', 'round_id', 'round_name', 'occurrence_id'],
                condition=~models.Q(occurrence_id=''), name='unique_round_occurrence_per_participation',
            ),
        ),
        migrations.AddConstraint(
            model_name='roundresult',
            constraint=models.UniqueConstraint(
                fields=['participation', 'round_id', 'round_name', 'exam_date'],
                condition=models.Q(occurrence_id=''), name='unique_round_day_without_occurrence',
            ),
        ),
    ]
