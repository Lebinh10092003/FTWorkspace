import { useEffect, useRef } from 'react';

export type WorkStatus = 'working' | 'idle' | 'home';

/** Thời gian không có thao tác để tính là trạng thái rảnh (idle): 5 phút */
export const IDLE_AFTER_MS = 5 * 60 * 1000;

/** Danh sách sự kiện người dùng thao tác trên toàn ứng dụng */
const USER_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

export const OFFICE_WORK_STATUS_STORAGE_KEY = 'ft_office_work_status';
export const OFFICE_WORK_STATUS_EVENT = 'ft-office:work-status-changed';

/**
 * Hook gửi nhịp hiện diện (heartbeat) về máy chủ mỗi ~60 giây khi người dùng
 * đã đăng nhập và tab đang hiển thị.
 *
 * Mở rộng:
 * - Theo dõi lần thao tác cuối (pointerdown/keydown/touchstart/scroll/wheel) có throttle.
 * - Sau 5 phút không thao tác -> idle = true.
 * - Hỗ trợ đồng bộ work_status ('working' | 'idle' | 'home').
 * - Gửi POST /api/office/heartbeat/ với body { idle: boolean, status: WorkStatus }.
 * - Gửi ngay khi đổi trạng thái (idle -> working khi thao tác lại, working -> idle khi hết 5 phút).
 * - Tab ẩn: dừng gửi (sau 3 phút backend tự coi là offline).
 * - Khi mở lại tab: tính là thao tác mới -> gửi ngay nhịp.
 */
export function useOfficeHeartbeat(
  token: string | null,
  isLoggedIn: boolean,
  workStatus?: WorkStatus,
  onWorkStatusChange?: (status: WorkStatus) => void,
) {
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const isLoggedInRef = useRef(isLoggedIn);
  isLoggedInRef.current = isLoggedIn;

  const isIdleRef = useRef(workStatus === 'idle');
  const workStatusRef = useRef<WorkStatus | undefined>(workStatus);
  workStatusRef.current = workStatus;

  const onWorkStatusChangeRef = useRef(onWorkStatusChange);
  onWorkStatusChangeRef.current = onWorkStatusChange;

  const lastActivityRef = useRef(Date.now());

  // Lắng nghe sự kiện đồng bộ trạng thái từ các component hoặc tab khác
  useEffect(() => {
    const handleStatusSync = (e: Event) => {
      const detail = (e as CustomEvent)?.detail as WorkStatus | undefined;
      if (detail && (detail === 'working' || detail === 'idle' || detail === 'home')) {
        workStatusRef.current = detail;
        isIdleRef.current = (detail === 'idle');
        if (onWorkStatusChangeRef.current) {
          onWorkStatusChangeRef.current(detail);
        }
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === OFFICE_WORK_STATUS_STORAGE_KEY && e.newValue) {
        const val = e.newValue as WorkStatus;
        if (val === 'working' || val === 'idle' || val === 'home') {
          workStatusRef.current = val;
          isIdleRef.current = (val === 'idle');
          if (onWorkStatusChangeRef.current) {
            onWorkStatusChangeRef.current(val);
          }
        }
      }
    };

    window.addEventListener(OFFICE_WORK_STATUS_EVENT, handleStatusSync);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(OFFICE_WORK_STATUS_EVENT, handleStatusSync);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !token) return;

    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
    let idleCheckTimeout: ReturnType<typeof setTimeout> | null = null;
    let lastThrottleTime = 0;

    const getStoredWorkStatus = (): WorkStatus => {
      if (workStatusRef.current) return workStatusRef.current;
      try {
        const stored = localStorage.getItem(OFFICE_WORK_STATUS_STORAGE_KEY) as WorkStatus | null;
        if (stored === 'working' || stored === 'idle' || stored === 'home') {
          return stored;
        }
      } catch {}
      return 'working';
    };

    const sendHeartbeat = (isIdle: boolean, targetStatus?: WorkStatus) => {
      if (document.hidden || !isLoggedInRef.current || !tokenRef.current) return;

      const currentStatus = targetStatus || workStatusRef.current || getStoredWorkStatus();
      const effectiveStatus: WorkStatus = currentStatus === 'home'
        ? 'home'
        : (currentStatus === 'idle' || isIdle ? 'idle' : 'working');

      fetch('/api/office/heartbeat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + tokenRef.current,
        },
        body: JSON.stringify({
          idle: effectiveStatus === 'idle',
          status: effectiveStatus,
        }),
      })
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          if (data && data.work_status) {
            const nextWs = data.work_status as WorkStatus;
            if (nextWs !== workStatusRef.current) {
              workStatusRef.current = nextWs;
              isIdleRef.current = (nextWs === 'idle');
              try {
                localStorage.setItem(OFFICE_WORK_STATUS_STORAGE_KEY, nextWs);
              } catch {}
              if (onWorkStatusChangeRef.current) {
                onWorkStatusChangeRef.current(nextWs);
              }
            }
          }
        })
        .catch(() => {
          // Lỗi mạng im lặng, không làm hỏng ứng dụng
        });
    };

    // Lên lịch kiểm tra chuyển sang trạng thái idle sau 5 phút không thao tác
    const scheduleIdleTimeout = () => {
      if (idleCheckTimeout) clearTimeout(idleCheckTimeout);
      const remainingMs = Math.max(0, IDLE_AFTER_MS - (Date.now() - lastActivityRef.current));
      idleCheckTimeout = setTimeout(() => {
        if (!document.hidden && !isIdleRef.current) {
          const currentStatus = workStatusRef.current || getStoredWorkStatus();
          // Nếu đang ở trạng thái về nhà thì giữ nguyên 'home'
          if (currentStatus === 'home') return;

          isIdleRef.current = true;
          workStatusRef.current = 'idle';
          try {
            localStorage.setItem(OFFICE_WORK_STATUS_STORAGE_KEY, 'idle');
          } catch {}
          if (onWorkStatusChangeRef.current) {
            onWorkStatusChangeRef.current('idle');
          }
          sendHeartbeat(true, 'idle');
        }
      }, remainingMs);
    };

    // Người dùng có thao tác trên ứng dụng
    const handleUserActivity = () => {
      const now = Date.now();
      lastActivityRef.current = now;

      const currentStatus = workStatusRef.current || getStoredWorkStatus();
      // Nếu người dùng chủ động chọn 'home', không tự động đổi thành working khi chỉ rê chuột
      if (currentStatus === 'home') {
        return;
      }

      // Nếu đang ở trạng thái rảnh (idle), thao tác lại -> chuyển ngay về working
      if (isIdleRef.current || currentStatus === 'idle') {
        isIdleRef.current = false;
        workStatusRef.current = 'working';
        try {
          localStorage.setItem(OFFICE_WORK_STATUS_STORAGE_KEY, 'working');
        } catch {}
        if (onWorkStatusChangeRef.current) {
          onWorkStatusChangeRef.current('working');
        }
        sendHeartbeat(false, 'working');
      }

      // Throttle việc lên lịch lại idle timer để tránh tốn tài nguyên khi scroll/move
      if (now - lastThrottleTime > 1000) {
        lastThrottleTime = now;
        scheduleIdleTimeout();
      }
    };

    // Khi khởi động: đồng bộ trạng thái ban đầu
    const initialStatus = workStatusRef.current || getStoredWorkStatus();
    isIdleRef.current = (initialStatus === 'idle');
    lastActivityRef.current = Date.now();
    sendHeartbeat(isIdleRef.current, initialStatus);
    scheduleIdleTimeout();

    // Chu kỳ gửi nhịp định kỳ mỗi ~60 giây khi tab hiển thị
    heartbeatInterval = setInterval(() => {
      const currentStatus = workStatusRef.current || getStoredWorkStatus();
      if (currentStatus === 'home') {
        sendHeartbeat(false, 'home');
        return;
      }
      const isIdle = (Date.now() - lastActivityRef.current) >= IDLE_AFTER_MS;
      if (isIdle !== isIdleRef.current) {
        isIdleRef.current = isIdle;
        const nextStatus: WorkStatus = isIdle ? 'idle' : 'working';
        workStatusRef.current = nextStatus;
        try {
          localStorage.setItem(OFFICE_WORK_STATUS_STORAGE_KEY, nextStatus);
        } catch {}
        if (onWorkStatusChangeRef.current) {
          onWorkStatusChangeRef.current(nextStatus);
        }
      }
      sendHeartbeat(isIdleRef.current, workStatusRef.current);
    }, 60000);

    // Xử lý khi tab ẩn/hiện
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        const currentStatus = workStatusRef.current || getStoredWorkStatus();
        if (currentStatus === 'home') {
          sendHeartbeat(false, 'home');
          return;
        }
        isIdleRef.current = false;
        workStatusRef.current = 'working';
        lastActivityRef.current = Date.now();
        try {
          localStorage.setItem(OFFICE_WORK_STATUS_STORAGE_KEY, 'working');
        } catch {}
        if (onWorkStatusChangeRef.current) {
          onWorkStatusChangeRef.current('working');
        }
        sendHeartbeat(false, 'working');
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
  }, [token, isLoggedIn, workStatus]);
}
