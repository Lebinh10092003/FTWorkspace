import { useEffect, useRef } from 'react';

/**
 * Hook gửi nhịp hiện diện (heartbeat) về máy chủ mỗi ~60 giây khi người dùng
 * đã đăng nhập và tab đang hiển thị.
 * Tự động tạm dừng khi tab bị ẩn và tiếp tục ngay khi tab được mở lại.
 * Mọi lỗi mạng đều được xử lý im lặng để không gây gián đoạn ứng dụng.
 */
export function useOfficeHeartbeat(token: string | null, isLoggedIn: boolean) {
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const isLoggedInRef = useRef(isLoggedIn);
  isLoggedInRef.current = isLoggedIn;

  useEffect(() => {
    if (!isLoggedIn || !token) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const sendHeartbeat = () => {
      if (document.hidden || !isLoggedInRef.current || !tokenRef.current) return;

      fetch('/api/office/heartbeat/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${tokenRef.current}`,
        },
      }).catch(() => {
        // Lỗi mạng im lặng, không làm hỏng app
      });
    };

    // Gửi ngay khi mở app
    sendHeartbeat();

    // Chu kỳ ~60 giây
    timer = setInterval(sendHeartbeat, 60000);

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Khi người dùng quay lại tab, gửi nhịp cập nhật tức thì
        sendHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [token, isLoggedIn]);
}
