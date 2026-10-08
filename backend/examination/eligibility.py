import re
import unicodedata

ELIGIBILITY_ELIGIBLE = 'Đủ điều kiện'
ELIGIBILITY_INELIGIBLE = 'Không đủ điều kiện'


def normalize_eligibility(value, default=''):
    """Collapse imported and manually entered eligibility into the two supported states."""
    raw = str(value or '').strip()
    if not raw:
        return default
    normalized = unicodedata.normalize('NFD', raw.casefold().replace('đ', 'd'))
    normalized = ''.join(char for char in normalized if not unicodedata.combining(char))
    normalized = re.sub(r'[^a-z0-9]+', '', normalized)
    # Nobody is marked eligible by default: an empty cell stays empty. The
    # first round admits every registrant implicitly (see eligible_for_round).
    if 'khongdudieukien' in normalized or 'chuadudieukien' in normalized:
        return ELIGIBILITY_INELIGIBLE
    return ELIGIBILITY_ELIGIBLE


def is_first_round(session, round_id):
    rounds = [item for item in (session.rounds or []) if isinstance(item, dict) and item.get('id')]
    return bool(rounds) and str(rounds[0].get('id')) == str(round_id)


def eligible_for_round_q(session, round_id):
    """Who sits a round: everyone registered for the first round unless marked
    ineligible; for later rounds only candidates explicitly marked eligible.

    Sessions without a round configuration (older seasons) never tracked
    eligibility, so everyone not marked ineligible is included there too.
    """
    from django.db.models import Q
    not_ineligible = ~(Q(eligibility__startswith='Không đủ') | Q(eligibility__startswith='không đủ')
                       | Q(eligibility__startswith='Chưa đủ') | Q(eligibility__startswith='chưa đủ'))
    configured = [item for item in (session.rounds or []) if isinstance(item, dict) and item.get('id')]
    if not configured or is_first_round(session, round_id):
        return not_ineligible
    return Q(eligibility=ELIGIBILITY_ELIGIBLE)
