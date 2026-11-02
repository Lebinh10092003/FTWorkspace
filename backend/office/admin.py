from django.contrib import admin
from .models import OfficePresence, OfficeSeat


@admin.register(OfficeSeat)
class OfficeSeatAdmin(admin.ModelAdmin):
    list_display = ('user', 'room', 'seat_index', 'is_head', 'updated_at')
    list_filter = ('room', 'is_head')
    search_fields = ('user__email', 'user__name')


@admin.register(OfficePresence)
class OfficePresenceAdmin(admin.ModelAdmin):
    list_display = ('user', 'last_seen', 'show_presence', 'updated_at')
    list_filter = ('show_presence',)
    search_fields = ('user__email', 'user__name')
