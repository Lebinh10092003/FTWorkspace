import { useEffect, useRef } from 'react';

/** Thời gian không có thao tác để tính là trạng thái rảnh (idle): 5 phút */
export const IDLE_AFTER_MS = 5 * 60 * 1000;

/** Danh sách sự kiện người dùng thao tác trên toàn ứng dụng */
const USER_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

/**
 * Hook gửi nhịp hiện diện (heartbeat) về máy chủ mỗi ~60 giây khi người dùng
 * đã đăng nhập và tab đang hiển thị.
 *
 * Mở rộng (Việc 033):
 * - Theo dõi lần thao tác cuối (pointerdown/keydown/touchstart/scroll/wheel) có throttle.
 * - Sau 5 phút không thao tác -> idle = true.
 * - Gửi POST /api/office/heartbeat/ với body { idle: boolean }.
 * - Gửi ngay khi đổi trạng thái (idle -> working khi thao tác lại, working -> idle khi hết 5 phút).
 * - Tab ẩn: dừng gửi (sau 3 phút backend tự coi là offline).
 * - Khi mở lại tab: tính là thao tác mới -> gửi ngay { idle: false }.
 */
export function useOfficeHeartbeat(token: string | null, isLoggedIn: boolean) {
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const isLoggedInRef = useRef(isLoggedIn);
  isLoggedInRef.current = isLoggedIn;

  const isIdleRef = useRef(false);
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (!isLoggedIn || !token) return;

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let idleCheckTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastThrottleTime = 0;

    const sendHeartbeat = (isIdle: boolean) => {
      if (document.hidden || !isLoggedInRef.current || !tokenRef.current) return;

      fetch('/api/office/heartbeat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
        body: JSON.stringify({ idle: isIdle }),
      }).catch(() => {
        // Lỗi mạng im lặng, không làm hỏng ứng dụng
      });
    };

    // Lên lịch kiểm tra chuyển sang trạng thái idle sau 5 phút không thao tác
    const scheduleIdleTimeout = () => {
      if (idleCheckTimeout) clearTimeout(idleCheckTimeout);
      const remainingMs = Math.max(0, IDLE_AFTER_MS - (Date.now() - lastActivityRef.current));
      idleCheckTimeout = setTimeout(() => {
        if (!document.hidden && !isIdleRef.current) {
          isIdleRef.current = true;
          // Gửi ngay thông báo trạng thái idle
          sendHeartbeat(true);
        }
      }, remainingMs);
    };

    // Người dùng có thao tác trên ứng dụng
    const handleUserActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;

      // Nếu đang ở trạng thái rảnh (idle), thao tác lại -> chuyển ngay về working
      if (isIdleRef.current) {
        isIdleRef.current = false;
        sendHeartbeat(false);
      }

      // Throttle việc lên lịch lại idle timer để tránh tốn tài nguyên khi scroll/move
      if (now - lastThrottleTime > 1000) {
        lastThrottleTime = now;
        scheduleIdleTimeout();
      }
    };

    // Gửi nhịp đầu tiên khi mở app (trạng thái working)
    isIdleRef.current = false;
    lastActivityRef.current = Date.now();
    sendHeartbeat(false);
    scheduleIdleTimeout();

    // Chu kỳ gửi nhịp định kỳ mỗi ~60 giây khi tab hiển thị
    heartbeatInterval = setInterval(() => {
      const isIdle = (Date.now() - lastActivityRef.current) >= IDLE_AFTER_MS;
      if (isIdle !== isIdleRef.current) {
        isIdleRef.current = isIdle;
      }
      sendHeartbeat(isIdleRef.current);
    }, 60000);

    // Xử lý khi tab ẩn/hiện
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Mở lại tab: tính là thao tác mới, chuyển working và gửi nhịp tức thì
        isIdleRef.current = false;
        lastActivityRef.current = Date.now();
        sendHeartbeat(false);
        scheduleIdleTimeout();
      } else {
        if (idleCheckTimeout) clearTimeout(idleCheckTimeout);
      }
    };

    // Đăng ký các sự kiện thao tác người dùng trên toàn ứng dụng
    USER_ACTIVITY_EVENTS.forEach(evt => {
      window.addEventListener(evt, handleUserActivity, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (idleCheckTimeout) clearTimeout(idleCheckTimeout);
      USER_ACTIVITY_EVENTS.forEach(evt => {
        window.removeEventListener(evt, handleUserActivity, { capture: true });
      });
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [token, isLoggedIn]);
}
