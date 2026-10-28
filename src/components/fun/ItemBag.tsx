import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Backpack, Cat, CloudFog, Volume2, VolumeX, X, Zap } from 'lucide-react';
import {
  ITEM_DEFINITIONS,
  ItemType,
  canTriggerFlashbang,
  isPointInsideRect,
} from './itemBagTypes';
import {
  getInitialMuted,
  playMeowSound,
  playPoofSound,
  playThrowSound,
  playTinnitusSound,
  saveMuted,
  stopTinnitusSound,
} from './itemBagAudio';
import './itemBag.css';

interface ActiveEffectState {
  id: string;
  type: ItemType;
  x: number;
  y: number;
  phase: 'exploding' | 'fading' | 'done';
}

interface DraggingItem {
  type: ItemType;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  lastPoints: { x: number; y: number; time: number }[];
}

export default function ItemBag() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(getInitialMuted);
  const [reducedMotion, setReducedMotion] = useState(false);

  // Hiệu ứng đang diễn ra
  const [activeEffect, setActiveEffect] = useState<ActiveEffectState | null>(null);
  const [catPoofing, setCatPoofing] = useState(false);

  // Trạng thái kéo thả
  const [dragging, setDragging] = useState<DraggingItem | null>(null);

  // Đạn đang bay theo quỹ đạo parabol
  const [flyingProjectile, setFlyingProjectile] = useState<{
    id: string;
    type: ItemType;
    currentX: number;
    currentY: number;
  } | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const triggerBtnRef = useRef<HTMLButtonElement>(null);
  const lastFlashTimeRef = useRef<number>(0);
  const effectTimeoutRef = useRef<any>(null);
  const animFrameRef = useRef<number | null>(null);

  // 1. Nhận biết chế độ giảm chuyển động của hệ điều hành
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // 2. Phím Esc đóng panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        triggerBtnRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // 3. Click ngoài panel để đóng
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(target) &&
        triggerBtnRef.current &&
        !triggerBtnRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isOpen]);

  // 4. Dọn dẹp khi unmount
  useEffect(() => {
    return () => {
      if (effectTimeoutRef.current) clearTimeout(effectTimeoutRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      stopTinnitusSound();
    };
  }, []);

  // Xử lý bật/tắt âm thanh
  const handleToggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      saveMuted(next);
      if (next) stopTinnitusSound();
      return next;
    });
  }, []);

  // Kích hoạt hiệu ứng sau khi ném tới đích
  const triggerEffectAt = useCallback(
    (type: ItemType, targetX: number, targetY: number) => {
      const now = Date.now();

      // Kiểm tra an toàn WCAG chống chớp giật liên tiếp cho bom choáng
      if (type === 'flash') {
        const isCurrentlyFlashing = activeEffect?.type === 'flash';
        if (!canTriggerFlashbang(isCurrentlyFlashing, lastFlashTimeRef.current, now)) {
          // Bỏ qua ném tiếp khi đang choáng
          return;
        }
        lastFlashTimeRef.current = now;
      }

      // Xóa timer cũ nếu có
      if (effectTimeoutRef.current) {
        clearTimeout(effectTimeoutRef.current);
        effectTimeoutRef.current = null;
      }

      const effectId = `${type}-${now}`;
      setActiveEffect({
        id: effectId,
        type,
        x: targetX,
        y: targetY,
        phase: 'exploding',
      });
      setCatPoofing(false);

      if (type === 'smoke') {
        playThrowSound(isMuted);
        effectTimeoutRef.current = setTimeout(() => {
          setActiveEffect(null);
        }, 5000);
      } else if (type === 'flash') {
        playTinnitusSound(isMuted, reducedMotion);
        effectTimeoutRef.current = setTimeout(() => {
          setActiveEffect(null);
        }, 5000);
      } else if (type === 'cat') {
        playMeowSound(isMuted);

        // Sau 2.3s: mèo biến mất trong làn khói
        effectTimeoutRef.current = setTimeout(() => {
          setCatPoofing(true);
          playPoofSound(isMuted);

          effectTimeoutRef.current = setTimeout(() => {
            setActiveEffect(null);
            setCatPoofing(false);
          }, 700);
        }, 2300);
      }
    },
    [activeEffect, isMuted, reducedMotion]
  );

  // Bắt đầu bay hoạt cảnh parabol từ (startX, startY) tới (targetX, targetY)
  const launchProjectile = useCallback(
    (type: ItemType, startX: number, startY: number, targetX: number, targetY: number) => {
      if (reducedMotion) {
        // Chế độ giảm chuyển động: nổ trực tiếp tại đích
        triggerEffectAt(type, targetX, targetY);
        return;
      }

      playThrowSound(isMuted);
      const startTime = performance.now();
      const duration = 480; // 480ms bay parabol
      const arcHeight = Math.min(180, Math.max(80, Math.abs(targetX - startX) * 0.45));

      const tick = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);

        // Interpolate X tuyến tính
        const currentX = startX + (targetX - startX) * progress;

        // Quỹ đạo cong Parabol (cung tròn)
        const straightY = startY + (targetY - startY) * progress;
        const arc = Math.sin(progress * Math.PI) * arcHeight;
        const currentY = straightY - arc;

        setFlyingProjectile({
          id: `${type}-${startTime}`,
          type,
          currentX,
          currentY,
        });

        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(tick);
        } else {
          setFlyingProjectile(null);
          triggerEffectAt(type, targetX, targetY);
        }
      };

      animFrameRef.current = requestAnimationFrame(tick);
    },
    [isMuted, reducedMotion, triggerEffectAt]
  );

  // Xử lý ném bằng bàn phím (Enter / Space): Ném ra giữa màn hình
  const handleKeyThrow = useCallback(
    (type: ItemType) => {
      setIsOpen(false);
      const rect = panelRef.current?.getBoundingClientRect();
      const startX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const startY = rect ? rect.top + rect.height / 2 : window.innerHeight - 100;

      // Điểm rơi ngẫu nhiên gần trung tâm màn hình
      const targetX = window.innerWidth / 2 + (Math.random() * 80 - 40);
      const targetY = window.innerHeight / 2 + (Math.random() * 80 - 40);

      launchProjectile(type, startX, startY, targetX, targetY);
    },
    [launchProjectile]
  );

  // Pointer Down trên item card
  const handlePointerDown = (type: ItemType, e: React.PointerEvent) => {
    // Chỉ kích hoạt chuột trái hoặc chạm
    if (e.button !== 0 && e.pointerType === 'mouse') return;

    setDragging({
      type,
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
      lastPoints: [{ x: e.clientX, y: e.clientY, time: performance.now() }],
    });
  };

  // Pointer Move
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    const now = performance.now();
    const updatedPoints = [...dragging.lastPoints, { x: e.clientX, y: e.clientY, time: now }].slice(-5);

    setDragging(prev =>
      prev
        ? {
            ...prev,
            currentX: e.clientX,
            currentY: e.clientY,
            lastPoints: updatedPoints,
          }
        : null
    );
  };

  // Pointer Up: Thả tay để ném
  const handlePointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    const dropX = e.clientX;
    const dropY = e.clientY;
    const itemType = dragging.type;
    const distMoved = Math.hypot(dropX - dragging.startX, dropY - dragging.startY);
    const panelRect = panelRef.current?.getBoundingClientRect();

    setDragging(null);

    // Nếu người dùng chỉ click vào thẻ mà không kéo (di chuyển < 10px):
    // Cho phép kích hoạt ném ra giữa màn hình
    if (distMoved < 10) {
      handleKeyThrow(itemType);
      return;
    }

    // Nếu có kéo, kiểm tra: nếu điểm thả nằm bên trong panel => HỦY NÉM
    if (panelRect && isPointInsideRect(dropX, dropY, panelRect)) {
      return;
    }

    // Đóng panel sau khi ném thành công
    setIsOpen(false);

    // Tính toán toạ độ đích theo lực vung tay
    const points = dragging.lastPoints;
    let vx = 0;
    let vy = 0;
    if (points.length >= 2) {
      const p1 = points[0];
      const p2 = points[points.length - 1];
      const dt = Math.max(16, p2.time - p1.time);
      vx = ((p2.x - p1.x) / dt) * 120;
      vy = ((p2.y - p1.y) / dt) * 120;
    }

    // Giới hạn cự ly đích rơi
    const targetX = Math.max(40, Math.min(window.innerWidth - 40, dropX + vx));
    const targetY = Math.max(60, Math.min(window.innerHeight - 60, dropY + vy));

    launchProjectile(itemType, dropX, dropY, targetX, targetY);
  };

  // Icon render helper
  const renderItemIcon = (type: ItemType, className: string = 'h-5 w-5') => {
    switch (type) {
      case 'smoke':
        return <CloudFog className={className} />;
      case 'flash':
        return <Zap className={className} />;
      case 'cat':
        return <Cat className={className} />;
    }
  };

  return (
    <>
      {/* ═════════════════════════════════════════════════════════
          1. Nút nổi Túi đồ (Floating Action Button)
          Vị trí: ngay bên trái nút Trợ lý AI (Chatbot)
          Đảm bảo không chồng đè nút Chatbot trên mọi kích thước màn hình
          ═════════════════════════════════════════════════════════ */}
      <button
        ref={triggerBtnRef}
        type="button"
        onClick={() => setIsOpen(prev => !prev)}
        aria-label="Túi đồ"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title="Túi đồ vui nhộn"
        className="fixed bottom-[calc(8.75rem+env(safe-area-inset-bottom,0px))] right-5 lg:bottom-6 lg:right-[5.75rem] z-40 flex h-12 w-12 lg:h-14 lg:w-14 items-center justify-center rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 text-white shadow-xl shadow-indigo-600/30 transition-all duration-200 hover:scale-105 hover:from-indigo-700 hover:to-violet-700 active:scale-95 focus:outline-none focus:ring-4 focus:ring-indigo-400/40 cursor-pointer"
      >
        <Backpack className="h-5 w-5 lg:h-6 lg:w-6 transition-transform duration-200 group-hover:rotate-6" />
      </button>

      {/* ═════════════════════════════════════════════════════════
          2. Panel Túi đồ (Item Bag Popover Panel)
          ═════════════════════════════════════════════════════════ */}
      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Túi đồ vui nhộn"
          className="fixed bottom-[calc(12.5rem+env(safe-area-inset-bottom,0px))] right-4 lg:bottom-22 lg:right-6 z-50 w-[320px] max-w-[calc(100vw-32px)] rounded-2xl border border-[var(--ft-border)] bg-[var(--ft-card-bg)] text-[var(--ft-text-main)] shadow-2xl p-4 transition-all duration-200"
          style={{ animation: 'ft-panel-pop 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {/* Header Panel */}
          <div className="flex items-center justify-between border-b border-[var(--ft-border)] pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                <Backpack className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-extrabold text-[13px] text-[var(--ft-text-main)]">Túi đồ</h3>
                <span className="text-[12px] text-[var(--ft-text-sub)]">Vô hạn số lượng</span>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={isMuted ? 'Bật âm thanh túi đồ' : 'Tắt âm thanh túi đồ'}
                title={isMuted ? 'Đang tắt âm' : 'Đang bật âm'}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--ft-text-sub)] hover:bg-[var(--ft-surface-2)] hover:text-[var(--ft-text-main)] transition cursor-pointer"
              >
                {isMuted ? <VolumeX className="h-4 w-4 text-rose-500" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Đóng túi đồ"
                className="flex h-11 w-11 items-center justify-center rounded-xl text-[var(--ft-text-sub)] hover:bg-[var(--ft-surface-2)] hover:text-[var(--ft-text-main)] transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Ghi chú chế độ giảm chuyển động nếu đang bật */}
          {reducedMotion && (
            <div className="mt-2.5 rounded-xl border border-amber-300/80 dark:border-amber-700/60 bg-amber-50/80 dark:bg-amber-950/40 p-2.5 text-[12px] text-amber-800 dark:text-amber-200 leading-normal">
              Chế độ <strong>Giảm chuyển động</strong> đang bật: bom choáng giảm sáng (≤40%), không phát âm ù tai.
            </div>
          )}

          {/* Hướng dẫn thao tác */}
          <p className="mt-2 text-[12px] text-[var(--ft-text-sub)] leading-relaxed">
            Giữ và <strong>kéo món đồ ra màn hình</strong> thả tay để ném, hoặc chọn món rồi nhấn <strong>Enter</strong>. Thả trong ô này = hủy.
          </p>

          {/* Danh sách 3 món đồ */}
          <div className="mt-3 space-y-2">
            {(Object.keys(ITEM_DEFINITIONS) as ItemType[]).map(type => {
              const def = ITEM_DEFINITIONS[type];
              return (
                <div
                  key={type}
                  role="button"
                  tabIndex={0}
                  aria-label={`${def.name}: ${def.shortDesc}. Bấm Enter để ném`}
                  onPointerDown={e => handlePointerDown(type, e)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleKeyThrow(type);
                    }
                  }}
                  className="group relative flex items-center justify-between p-2.5 rounded-xl border border-[var(--ft-border)] bg-[var(--ft-surface-2)]/60 hover:bg-[var(--ft-surface-2)] hover:border-indigo-300 dark:hover:border-indigo-600 transition-all select-none cursor-grab active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[52px]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ft-card-bg)] shadow-xs ${def.colorClass}`}
                    >
                      {renderItemIcon(type, 'h-5 w-5')}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-[13px] text-[var(--ft-text-main)] truncate">
                          {def.name}
                        </span>
                        <span
                          className={`text-[12px] font-extrabold px-1.5 py-0.2 rounded-md ${def.badgeBg}`}
                        >
                          {def.tag}
                        </span>
                      </div>
                      <p className="text-[12px] text-[var(--ft-text-sub)] truncate leading-normal">
                        {def.shortDesc}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      handleKeyThrow(type);
                    }}
                    aria-label={`Ném ${def.name}`}
                    className="shrink-0 text-[12px] font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 pl-2 cursor-pointer py-1.5 px-2.5 rounded-lg hover:bg-indigo-100/60 dark:hover:bg-indigo-950/60 transition"
                  >
                    Ném ↵
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════
          3. Icon đang được kéo theo con trỏ chuột/tay
          ═════════════════════════════════════════════════════════ */}
      {dragging && (
        <div
          className="fixed z-[9999] pointer-events-none -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 rounded-2xl bg-indigo-600/90 text-white px-3.5 py-2 shadow-2xl backdrop-blur-xs"
          style={{ left: dragging.currentX, top: dragging.currentY }}
        >
          {renderItemIcon(dragging.type, 'h-6 w-6')}
          <span className="text-[12px] font-bold">Thả để ném!</span>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════
          4. Đạn đang bay theo quỹ đạo parabol
          ═════════════════════════════════════════════════════════ */}
      {flyingProjectile && (
        <div
          className="ft-flying-projectile flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-xl"
          style={{
            left: flyingProjectile.currentX,
            top: flyingProjectile.currentY,
          }}
        >
          {renderItemIcon(flyingProjectile.type, 'h-6 w-6 animate-pulse')}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════
          5. Hiệu ứng toàn màn hình (pointer-events: none bắt buộc)
          ═════════════════════════════════════════════════════════ */}

      {/* Hiệu ứng 1: Bom khói 5 giây */}
      {activeEffect?.type === 'smoke' && (
        <div className="ft-smoke-overlay" aria-hidden="true">
          <div className="ft-smoke-cloud w-96 h-96 -top-10 -left-10" />
          <div className="ft-smoke-cloud w-[500px] h-[500px] top-1/4 right-0" />
          <div className="ft-smoke-cloud w-80 h-80 bottom-0 left-1/3" />
        </div>
      )}

      {/* Hiệu ứng 2: Bom choáng kiểu CS2 (trắng xóa, mờ dần 5s) */}
      {activeEffect?.type === 'flash' && (
        <>
          <div className="ft-flash-overlay" aria-hidden="true" />
          {!reducedMotion && <div className="ft-flash-afterimage" aria-hidden="true" />}
        </>
      )}

      {/* Hiệu ứng 3: Chú mèo hoạt hình xuất hiện & cụm khói poof */}
      {activeEffect?.type === 'cat' && (
        <div
          className="ft-cat-actor flex flex-col items-center"
          style={{ left: activeEffect.x, top: activeEffect.y }}
          aria-hidden="true"
        >
          {!catPoofing ? (
            <div className="relative flex flex-col items-center">
              {/* Bong bóng thoại "Meo meo~" */}
              <div className="mb-2 rounded-2xl bg-white dark:bg-slate-800 px-3 py-1.5 shadow-xl border border-rose-200 dark:border-rose-900/60 text-rose-600 dark:text-rose-400 font-extrabold text-[12px] animate-bounce">
                Meo meo~
              </div>

              {/* Chú mèo minh họa SVG vector hoạt hình */}
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-tr from-amber-100 to-rose-100 dark:from-slate-800 dark:to-slate-700 shadow-2xl border-2 border-white dark:border-slate-600 text-rose-500">
                <Cat className="h-12 w-12" />
              </div>
            </div>
          ) : (
            /* Cụm khói trắng hoạt hình kiểu Doraemon khi mèo biến mất */
            <div className="ft-cat-poof-cloud flex items-center justify-center">
              <div className="h-28 w-28 rounded-full bg-white/90 shadow-2xl blur-xs flex items-center justify-center">
                <CloudFog className="h-16 w-16 text-slate-300" />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
