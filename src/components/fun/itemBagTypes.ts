export type ItemType = 'smoke' | 'flash' | 'cat';

export interface ItemInfo {
  id: ItemType;
  name: string;
  shortDesc: string;
  tag: string;
  colorClass: string;
  badgeBg: string;
  /** Thời gian hiệu ứng hiện trên màn hình (ms). */
  durationMs: number;
}

/** Mèo biến mất trong làn khói trong khoảng này ở cuối hiệu ứng. */
export const CAT_POOF_MS = 700;

export const ITEM_DEFINITIONS: Record<ItemType, ItemInfo> = {
  smoke: {
    id: 'smoke',
    name: 'Bom khói',
    shortDesc: 'Màn khói xám phủ toàn màn hình trong 5 giây rồi tan dần',
    tag: '5 giây',
    colorClass: 'text-slate-600 dark:text-slate-300',
    badgeBg: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    durationMs: 5000,
  },
  flash: {
    id: 'flash',
    name: 'Bom choáng',
    shortDesc: 'Kiểu CS2: bùng sáng đặc, mờ dần 5s kèm tiếng ù tai',
    tag: 'CS2 5s',
    colorClass: 'text-amber-500 dark:text-amber-400',
    badgeBg: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
    durationMs: 5000,
  },
  cat: {
    id: 'cat',
    name: 'Mèo',
    shortDesc: 'Chú mèo xuất hiện, kêu "meo meo" rồi biến mất trong khói',
    tag: 'Hoạt hình',
    colorClass: 'text-rose-500 dark:text-rose-400',
    badgeBg: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200',
    durationMs: 3000,
  },
};

export interface RectBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Kiểm tra xem toạ độ (x, y) có nằm trong vùng hình chữ nhật (RectBounds) không
 */
export function isPointInsideRect(x: number, y: number, bounds: RectBounds | null | undefined): boolean {
  if (!bounds) return false;
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

/**
 * Ràng buộc an toàn WCAG 2.1 (Photosensitive Epilepsy):
 * Chỉ cho phép bùng sáng 1 lần; nếu đang trong trạng thái choáng, bỏ qua lần kích hoạt tiếp theo.
 * Giới hạn tối thiểu giữa 2 lần nổ bom choáng là 4.5 giây.
 */
export function canTriggerFlashbang(isFlashingNow: boolean, lastFlashTimestamp: number, nowTimestamp: number): boolean {
  if (isFlashingNow) return false;
  if (nowTimestamp - lastFlashTimestamp < 4500) return false;
  return true;
}

export interface FlyingProjectile {
  id: string;
  type: ItemType;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  currentX: number;
  currentY: number;
  progress: number; // 0 -> 1
  rot: number;
}
