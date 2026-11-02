import re
from rest_framework import serializers

from .models import (
    ROOM_CHOICES,
    ROOM_COMMON,
    ROOM_DIRECTOR,
    ROOM_TECH,
    ROOM_EXAM,
    ROOM_ACCOUNTING,
    ROOM_CAPACITIES,
    OfficeSeat,
    OfficePresence,
)


HEX_COLOR_REGEX = re.compile(r'^#(?:[0-9a-fA-F]{3}){1,2}$')

ALLOWED_HAIR_STYLES = {
    'none', 'short', 'medium', 'long', 'curly', 'bald', 'ponytail', 'bun', 'buzz', 'wavy', 'afro'
}

ALLOWED_GLASSES = {
    'none', 'round', 'square', 'sunglasses', 'reading', 'wire'
}


def is_valid_hex_color(val: str) -> bool:
    if not isinstance(val, str):
        return False
    return bool(HEX_COLOR_REGEX.match(val.strip()))


class AvatarConfigSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=50, required=False, allow_blank=True)
    skin_color = serializers.CharField(max_length=20, required=False)
    hair_style = serializers.CharField(max_length=30, required=False)
    hair_color = serializers.CharField(max_length=20, required=False)
    outfit_color = serializers.CharField(max_length=20, required=False)
    glasses = serializers.CharField(max_length=30, required=False)
    show_presence = serializers.BooleanField(required=False)

    def validate_skin_color(self, value):
        val = value.strip().lower()
        if not is_valid_hex_color(val):
            raise serializers.ValidationError('Màu da phải là mã HEX hợp lệ (ví dụ #fadcbc).')
        return val

    def validate_hair_style(self, value):
        val = value.strip().lower()
        if val not in ALLOWED_HAIR_STYLES:
            raise serializers.ValidationError(f"Kiểu tóc không hợp lệ. Cho phép: {', '.join(sorted(ALLOWED_HAIR_STYLES))}.")
        return val

    def validate_hair_color(self, value):
        val = value.strip().lower()
        if not is_valid_hex_color(val):
            raise serializers.ValidationError('Màu tóc phải là mã HEX hợp lệ (ví dụ #090806).')
        return val

    def validate_outfit_color(self, value):
        val = value.strip().lower()
        if not is_valid_hex_color(val):
            raise serializers.ValidationError('Màu áo phải là mã HEX hợp lệ (ví dụ #3b82f6).')
        return val

    def validate_glasses(self, value):
        val = value.strip().lower()
        if val not in ALLOWED_GLASSES:
            raise serializers.ValidationError(f"Kiểu kính không hợp lệ. Cho phép: {', '.join(sorted(ALLOWED_GLASSES))}.")
        return val

    def validate_display_name(self, value):
        val = value.strip()
        if len(val) > 50:
            raise serializers.ValidationError('Tên hiển thị không được vượt quá 50 ký tự.')
        return val


class OfficeSeatUpdateSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True)
    room = serializers.ChoiceField(choices=ROOM_CHOICES, required=True)
    seat_index = serializers.IntegerField(min_value=1, max_value=20, required=False, allow_null=True)
    is_head = serializers.BooleanField(required=False, default=False)

    def validate(self, attrs):
        room = attrs.get('room')
        seat_index = attrs.get('seat_index')

        if room == ROOM_COMMON:
            # Phòng chung không có seat_index cố định
            attrs['seat_index'] = None
        else:
            max_seats = ROOM_CAPACITIES.get(room)
            if max_seats and seat_index is not None and seat_index > max_seats:
                raise serializers.ValidationError({
                    'seat_index': f'{room} chỉ có tối đa {max_seats} chỗ ngồi.'
                })
        return attrs
