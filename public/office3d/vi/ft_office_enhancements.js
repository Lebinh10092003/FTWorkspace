/**
 * ft_office_enhancements.js - Văn phòng ảo Isometric FermatTech 2.5D
 * 
 * Tính năng chính:
 * 1. Chuyển đổi tạo hình Robot Voxel Isometric cho toàn bộ Bot AI & Khảo thí
 * 2. Hàng chờ vật lý (Queue Physicalization): Robot di chuyển tới bàn người dùng khi được gọi
 * 3. Cơ chế Giám đốc tuần tra & Nhân viên vội vã chạy về bàn (RUSH_TO_DESK)
 * 4. Làm giàu kho thoại vu vơ ngẫu nhiên mang đậm chất văn phòng FermatTech
 */

(function () {
  'use strict';

  console.log('[FT Office] Enhancements v2.6 initializing...');

  // Kho câu thoại ngẫu nhiên mang đậm bản sắc FermatTech
  const FERMAT_IDLE_QUOTES = {
    tech: [
      'Prompt này cho ra kết quả đỉnh thật! 🤖',
      'Model vừa fine-tune xong, accuracy 98.6%! 🚀',
      'Đang kiểm tra lại API Gateway của hệ thống.',
      'Fix xong bug giao diện rồi, chuẩn bị push thôi!',
      'Hệ sinh thái chuyển đổi số này chạy mượt phết!',
      'Turbopack build nhanh thật, đỡ mất thời gian đợi.',
      'Đang tối ưu lại Three.js render cho văn phòng ảo 🎮'
    ],
    exam: [
      'Đang sinh đề thi đánh giá năng lực đợt 2 📝',
      'Học sinh nộp bài thi liên tục, server vẫn mượt! ⚡',
      'Check lại đáp án câu 40 mã đề 102 nào...',
      'Ngân hàng câu hỏi vừa nạp thêm 500 bài toán chuẩn hóa 📚',
      'Hệ thống chấm thi tự động AI quét chính xác 99.9%!',
      'Đang xuất phiếu báo điểm cho các trường đối tác 📊'
    ],
    accounting: [
      'Báo cáo thu chi tháng này đã cân đối xong 💵',
      'Chuẩn bị duyệt chi ngân sách hạ tầng máy chủ AI 💻',
      'Hóa đơn điện tử đợt này khớp 100% rồi.',
      'Đối soát xong công nợ các đơn vị đối tác 📋'
    ],
    general: [
      'Trưa nay ăn gì cả nhà ơi? Bún đậu hay cơm tấm? 🍱',
      'Cà phê phin pha xong rồi, ai làm một ly không? ☕',
      'Hôm nay quyết tâm không OT, về sớm đá bóng! ⚽',
      'Văn phòng mát rượi, làm việc tập trung hẳn ✨',
      'Uống nước đầy đủ nào mọi người ơi! 💧'
    ]
  };

  const RUSH_QUOTES = [
    'Ối sếp đi kiểm tra kìa! 😱',
    'Về bàn nhanh anh em ơi! 🏃‍♂️💨',
    'Sếp tới kìa! Chạy mau! ⚡',
    'Đang làm báo cáo nè sếp ơi! 📑',
    'Hú hồn, chạy về chỗ thôi!'
  ];

  const RELIEF_QUOTES = [
    'Phù... may quá sếp không để ý 😮‍💨',
    'Hú hồn chim én! 😅',
    'May mà chạy về kịp bàn...',
    'Tập trung làm việc tiếp thôi nào! 💻'
  ];

  const ROBOT_GREETINGS = [
    '🤖 Bíp! Trợ lý AI đã tới bàn bạn. Cần tôi giúp gì nào?',
    '🤖 Chào bạn! Tôi là Robot AI FermatTech, sẵn sàng nhận lệnh.',
    '🤖 Đã có mặt tại bàn! Mời bạn thao tác trên Virtual OS.',
    '🤖 Bíp bíp! Đang kích hoạt module hỗ trợ công việc.'
  ];

  let THREE = null;
  let office = null;
  let ftOffice = null;
  let robotEyeMaterials = [];
  let isPatrolling = false;

  // Hàng đợi gọi Robot vật lý
  const botQueue = [];
  let activeBotMission = null;

  function init() {
    office = window.__office || {};
    ftOffice = window.__ftOffice || {};
    THREE = office.THREE || window.THREE;

    if (!THREE || !ftOffice.getWorkers) {
      setTimeout(init, 300);
      return;
    }

    console.log('[FT Office] Dependencies ready. Hooking enhancements.');

    // 1. Quét biến đổi Bot thành Robot Voxel
    setInterval(upgradeAllBotsToRobotMesh, 1500);

    // 2. Chạy vòng lặp thoại ngẫu nhiên chất FermatTech
    setInterval(tickFermatIdleQuotes, 8000);

    // 3. Vòng lặp nhấp nháy mắt & đèn ăng-ten Robot
    setInterval(animateRobotEyes, 400);

    // 4. Tuần tra Giám đốc định kỳ (mỗi 75 - 120s ngẫu nhiên)
    scheduleNextDirectorPatrol();

    // 5. Lắng nghe các lệnh điều khiển từ Host (OfficeWorkspace.tsx)
    setupMessageListeners();

    // Phơi bày hàm tuần tra ra ngoài
    window.__ftPatrolNow = triggerDirectorPatrol;
    window.__ftCallBotToDesk = callBotToUserDesk;
    window.__ftReleaseBot = releaseActiveBot;

    // Báo ready
    postToParent({ type: 'ft-office:enhancements-ready' });
  }

  function postToParent(msg) {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(msg, '*');
    }
  }

  /**
   * 1. BIẾN ĐỔI TOÀN BỘ BOT AI THÀNH ROBOT VOXEL ISOMETRIC
   */
  function upgradeAllBotsToRobotMesh() {
    if (!ftOffice.getWorkers || !ftOffice.getSessions) return;
    const workers = ftOffice.getWorkers();
    const sessions = ftOffice.getSessions();

    for (const [id, worker] of workers.entries()) {
      const session = sessions.get(id);
      if (!session) continue;

      const isBot = session.isBot ||
        session.role === 'BOT' ||
        (session.name && (session.name.startsWith('AI ') || session.name.toLowerCase().includes('bot'))) ||
        (typeof id === 'string' && id.startsWith('bot-'));

      if (isBot && !worker._ftRobotUpgraded && worker.P && worker.P.head) {
        transformWorkerToRobot(worker, session);
      }
    }
  }

  function transformWorkerToRobot(worker, session) {
    try {
      worker._ftRobotUpgraded = true;
      const head = worker.P.head;

      // Ẩn tóc và kính gốc
      if (head.children) {
        head.children.forEach(c => {
          if (c !== worker.P.neck) {
            c.visible = false;
          }
        });
      }

      // Tạo nhóm đầu Robot Voxel Isometric đặc trưng FermatTech
      const robotGroup = new THREE.Group();
      robotGroup.name = 'ft_robot_head';

      // Hộp sọ Robot Voxel (Màu xám ánh kim hoặc xám kem sạch sẽ)
      const headGeo = new THREE.BoxGeometry(0.24, 0.22, 0.22);
      const headMat = new THREE.MeshStandardMaterial({
        color: '#D8E2DC',
        metalness: 0.65,
        roughness: 0.35
      });
      const headMesh = new THREE.Mesh(headGeo, headMat);
      headMesh.position.y = 0.02;
      headMesh.castShadow = true;
      robotGroup.add(headMesh);

      // Màn hình mặt trước LED màu Navy đậm
      const faceGeo = new THREE.BoxGeometry(0.20, 0.16, 0.02);
      const faceMat = new THREE.MeshBasicMaterial({ color: '#111827' });
      const faceMesh = new THREE.Mesh(faceGeo, faceMat);
      faceMesh.position.set(0, 0.02, 0.112);
      robotGroup.add(faceMesh);

      // Hai mắt LED sáng xanh Cyan hoặc Cam đất
      const isLeadBot = session.name && session.name.includes('Đăng bài');
      const eyeColor = isLeadBot ? '#D97757' : '#06B6D4';
      const eyeMat = new THREE.MeshBasicMaterial({ color: eyeColor });
      robotEyeMaterials.push(eyeMat);

      const eyeGeo = new THREE.BoxGeometry(0.045, 0.035, 0.015);
      const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
      leftEye.position.set(-0.055, 0.03, 0.122);
      const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
      rightEye.position.set(0.055, 0.03, 0.122);
      robotGroup.add(leftEye, rightEye);

      // Ăng-ten đỉnh đầu
      const antPoleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.09, 8);
      const antPoleMat = new THREE.MeshStandardMaterial({ color: '#4B5563', metalness: 0.8 });
      const antPole = new THREE.Mesh(antPoleGeo, antPoleMat);
      antPole.position.set(0, 0.17, 0);
      robotGroup.add(antPole);

      // Quả cầu đèn tín hiệu ăng-ten (Beacon LED)
      const antBulbGeo = new THREE.SphereGeometry(0.022, 12, 10);
      const antBulbMat = new THREE.MeshBasicMaterial({ color: '#F59E0B' });
      const antBulb = new THREE.Mesh(antBulbGeo, antBulbMat);
      antBulb.position.set(0, 0.22, 0);
      robotGroup.add(antBulb);
      worker._ftAntBulbMat = antBulbMat;

      // 2 Tai nghe/khớp cơ khí 2 bên đầu
      const earGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.03, 10);
      earGeo.rotateZ(Math.PI / 2);
      const earMat = new THREE.MeshStandardMaterial({ color: '#D97757', roughness: 0.4 });
      const leftEar = new THREE.Mesh(earGeo, earMat);
      leftEar.position.set(-0.13, 0.02, 0);
      const rightEar = new THREE.Mesh(earGeo, earMat);
      rightEar.position.set(0.13, 0.02, 0);
      robotGroup.add(leftEar, rightEar);

      head.add(robotGroup);

      // Cập nhật tag hiển thị trên đầu
      if (worker.tagDot) {
        worker.tagDot.style.background = '#06B6D4';
        worker.tagDot.style.boxShadow = '0 0 8px #06B6D4';
      }
      if (worker.tagEl) {
        worker.tagEl.title = `[Robot AI] ${session.name}`;
      }

      console.log(`[FT Office] Transformed bot ${session.name} (${session.id}) to voxel robot!`);
    } catch (err) {
      console.warn('[FT Office] Failed to transform bot:', err);
    }
  }

  function animateRobotEyes() {
    const shouldBlink = Math.random() < 0.15;
    robotEyeMaterials.forEach(mat => {
      if (shouldBlink) {
        mat.color.set('#0F172A'); // Nhắm mắt
        setTimeout(() => mat.color.set('#06B6D4'), 120);
      }
    });

    // Nhấp nháy đèn ăng-ten
    if (ftOffice.getWorkers) {
      const workers = ftOffice.getWorkers();
      workers.forEach(w => {
        if (w._ftAntBulbMat) {
          const t = Date.now() / 300;
          const bright = (Math.sin(t) + 1) / 2 > 0.4;
          w._ftAntBulbMat.color.set(bright ? (w._ftServing ? '#10B981' : '#F59E0B') : '#78350F');
        }
      });
    }
  }

  /**
   * 2. HÀNG CHỜ VẬT LÝ ROBOT AI (QUEUE PHYSICALIZATION)
   */
  function callBotToUserDesk(targetDeskIndex, requesterName = 'Bạn') {
    if (targetDeskIndex === undefined || targetDeskIndex === null) {
      targetDeskIndex = ftOffice.getMyDeskIndex ? ftOffice.getMyDeskIndex() : 14;
    }

    const requestId = 'req_' + Date.now();
    botQueue.push({ requestId, targetDesk: targetDeskIndex, requesterName, time: Date.now() });

    console.log(`[FT Office] Added bot request to queue. Length: ${botQueue.length}`);
    processBotQueue();
    broadcastQueueState();
    return requestId;
  }

  function processBotQueue() {
    if (!botQueue.length) return;
    if (activeBotMission) return; // Đang có bot phục vụ

    const request = botQueue.shift();
    const botWorker = findAvailableBot();

    if (!botWorker) {
      // Không có bot rảnh, trả lại hàng chờ đầu
      botQueue.unshift(request);
      return;
    }

    dispatchBotToDesk(botWorker, request);
  }

  function findAvailableBot() {
    if (!ftOffice.getWorkers || !ftOffice.getSessions) return null;
    const workers = ftOffice.getWorkers();
    const sessions = ftOffice.getSessions();

    for (const [id, worker] of workers.entries()) {
      const session = sessions.get(id);
      if (!session) continue;
      const isBot = session.isBot ||
        session.role === 'BOT' ||
        (session.name && (session.name.startsWith('AI ') || session.name.includes('Bot')));

      if (isBot && !worker._ftServing && !worker._ftMovingToUser && !worker.leaving) {
        return worker;
      }
    }
    return null;
  }

  function dispatchBotToDesk(worker, request) {
    activeBotMission = { worker, request, stage: 'MOVING' };
    worker._ftMovingToUser = true;

    const nav = ftOffice.getNav ? ftOffice.getNav() : null;
    const deskSpots = nav?.DESK_SPOTS || [];
    const targetDesk = deskSpots[request.targetDesk] || deskSpots[14] || { x: 0, z: 0, face: 0 };

    // Điểm đứng cạnh bàn người dùng (lệch sang phải/trước một chút để giao tiếp)
    const standSpot = {
      x: targetDesk.x + 0.65,
      z: targetDesk.z + 0.35,
      face: Math.atan2(targetDesk.x - (targetDesk.x + 0.65), targetDesk.z - (targetDesk.z + 0.35)),
      node: targetDesk.node,
      sit: false
    };

    worker.say('prompt', '🤖 Nhận lệnh! Tôi đang di chuyển tới bàn làm việc...');
    postToParent({
      type: 'ft-office:botState',
      state: 'MOVING',
      botName: worker.name || 'Robot AI',
      targetDesk: request.targetDesk,
      queueLength: botQueue.length
    });

    worker.goTo(standSpot, () => {
      worker._ftMovingToUser = false;
      worker._ftServing = true;
      activeBotMission.stage = 'SERVING';

      // Quay mặt về phía người dùng
      worker.faceTarget = standSpot.face;
      worker.anim = 'idle';

      const greeting = ROBOT_GREETINGS[Math.floor(Math.random() * ROBOT_GREETINGS.length)];
      worker.say('idle', greeting);

      postToParent({
        type: 'ft-office:botState',
        state: 'ARRIVED',
        botName: worker.name || 'Robot AI',
        targetDesk: request.targetDesk,
        queueLength: botQueue.length
      });
    });
  }

  function releaseActiveBot() {
    if (!activeBotMission || !activeBotMission.worker) {
      postToParent({ type: 'ft-office:botState', state: 'IDLE', queueLength: botQueue.length });
      return;
    }

    const worker = activeBotMission.worker;
    worker._ftServing = false;
    worker._ftMovingToUser = false;

    worker.say('idle', '🤖 Đã xong việc! Tôi quay về bàn trực đây.');

    const home = worker.homeSpot ? worker.homeSpot() : null;
    if (home) {
      worker.goTo(home, () => {
        worker.anim = 'type';
        activeBotMission = null;
        postToParent({
          type: 'ft-office:botState',
          state: 'IDLE',
          queueLength: botQueue.length
        });
        // Tiếp tục xử lý hàng đợi nếu còn người chờ
        setTimeout(processBotQueue, 1000);
      });
    } else {
      activeBotMission = null;
      setTimeout(processBotQueue, 1000);
    }
  }

  function broadcastQueueState() {
    postToParent({
      type: 'ft-office:queueUpdate',
      queueLength: botQueue.length,
      isServing: !!activeBotMission,
      activeMission: activeBotMission ? {
        stage: activeBotMission.stage,
        targetDesk: activeBotMission.request.targetDesk,
        requester: activeBotMission.request.requesterName
      } : null
    });
  }

  /**
   * 3. GIÁM ĐỐC TUẦN TRA & NHÂN VIÊN VỘI VÃ CHẠY VỀ BÀN (RUSH_TO_DESK)
   */
  function scheduleNextDirectorPatrol() {
    const delay = 65000 + Math.random() * 55000; // 65s - 120s
    setTimeout(() => {
      if (!isPatrolling) {
        triggerDirectorPatrol();
      }
      scheduleNextDirectorPatrol();
    }, delay);
  }

  function triggerDirectorPatrol() {
    const director = ftOffice.getDirector ? ftOffice.getDirector() : null;
    if (!director || isPatrolling) return;

    isPatrolling = true;
    console.log('[FT Office] Director patrol started!');

    director.hush && director.hush();
    director.say('prompt', '📋 Đi kiểm tra các phòng ban xem anh em làm việc thế nào!');

    postToParent({
      type: 'ft-office:patrolState',
      active: true,
      phase: 'START',
      message: 'Giám đốc đang bắt đầu tuần tra các phòng ban!'
    });

    // 1. Kích hoạt hiệu ứng RUSH_TO_DESK cho nhân viên
    triggerRushToDesk();

    // 2. Lộ trình tuần tra qua các phòng ban
    const nav = ftOffice.getNav ? ftOffice.getNav() : null;
    const deskSpots = nav?.DESK_SPOTS || [];

    // Các điểm ghé thăm tuần tự
    const patrolWaypoints = [
      // Điểm 1: Cụm Công nghệ
      deskSpots[12] ? { x: deskSpots[12].x + 0.8, z: deskSpots[12].z - 0.5, face: 0, text: 'Phòng Công nghệ code mượt lắm! Cố gắng nhé! 👍' } : null,
      // Điểm 2: Cụm Khảo thí
      deskSpots[20] ? { x: deskSpots[20].x - 0.7, z: deskSpots[20].z + 0.5, face: Math.PI / 2, text: 'Hệ thống Khảo thí hôm nay đề ra chuẩn chứ? 📝' } : null,
      // Điểm 3: Cụm Kế toán & Pantry
      deskSpots[28] ? { x: deskSpots[28].x + 0.5, z: deskSpots[28].z - 0.5, face: -Math.PI / 2, text: 'Kế toán đối soát kỹ lưỡng nhé các em! 💵' } : null,
      // Về lại phòng Giám đốc
      director.homeSpot ? director.homeSpot() : { x: -5.4, z: -6.75, face: 0, sit: true }
    ].filter(Boolean);

    runPatrolChain(director, patrolWaypoints, 0);
  }

  function triggerRushToDesk() {
    if (!ftOffice.getWorkers || !ftOffice.getSessions) return;
    const workers = ftOffice.getWorkers();
    const sessions = ftOffice.getSessions();

    workers.forEach((worker, id) => {
      const session = sessions.get(id);
      if (!session) return;
      if (session.room === 'director') return; // Không áp dụng cho giám đốc

      // Những nhân viên đang đi lang thang hoặc không ở bàn
      const isAwayFromDesk = worker.station !== 'desk' || worker.phase === 'walk';

      if (isAwayFromDesk && worker.homeSpot) {
        worker.want = null;
        worker.ftNext = (window.__office?.sim || 0) + 40;

        // Bubble hoảng hốt
        const panicLine = RUSH_QUOTES[Math.floor(Math.random() * RUSH_QUOTES.length)];
        worker.say('idle', panicLine);

        // Tăng tốc độ gấp đôi để tạo cảm giác hớt hải
        const origSpeed = worker.speed || 1;
        worker.speed = origSpeed * 2.2;

        worker.goTo(worker.homeSpot(), () => {
          worker.speed = origSpeed;
          worker.anim = 'type';
          worker.say('idle', 'Tập trung làm việc... 💻');
        });
      } else {
        // Đang ở bàn thì gõ phím cật lực
        worker.anim = 'type';
      }
    });
  }

  function runPatrolChain(director, waypoints, index) {
    if (index >= waypoints.length) {
      // Kết thúc tuần tra
      isPatrolling = false;
      director.anim = 'type';
      director.say('idle', 'Anh em làm việc rất nghiêm túc, tốt lắm! 👏');

      // Nhân viên thở phào nhẹ nhõm
      setTimeout(triggerWorkersRelief, 1800);

      postToParent({
        type: 'ft-office:patrolState',
        active: false,
        phase: 'DONE',
        message: 'Giám đốc đã hoàn thành đợt kiểm tra.'
      });
      return;
    }

    const wp = waypoints[index];
    director.goTo(wp, () => {
      director.anim = 'tidy';
      if (wp.text) {
        director.say('idle', wp.text);
      }
      setTimeout(() => {
        runPatrolChain(director, waypoints, index + 1);
      }, 3500);
    });
  }

  function triggerWorkersRelief() {
    if (!ftOffice.getWorkers) return;
    const workers = Array.from(ftOffice.getWorkers().values());
    // Chọn ngẫu nhiên 2 - 3 nhân viên phát biểu thở phào
    const luckyWorkers = workers.filter(w => !w._ftRobotUpgraded).slice(0, 3);
    luckyWorkers.forEach(w => {
      const line = RELIEF_QUOTES[Math.floor(Math.random() * RELIEF_QUOTES.length)];
      w.say('idle', line);
    });
  }

  /**
   * 4. LÀM GIÀU KHO THOẠI VU VƠ NGẪU NHIÊN CHUẨN FERMATTECH
   */
  function tickFermatIdleQuotes() {
    if (isPatrolling) return;
    if (!ftOffice.getWorkers || !ftOffice.getSessions) return;

    const workers = Array.from(ftOffice.getWorkers().entries());
    if (!workers.length) return;

    // Chọn 1 nhân viên ngẫu nhiên đang ngồi làm việc
    const [id, worker] = workers[Math.floor(Math.random() * workers.length)];
    const session = ftOffice.getSessions().get(id);
    if (!session || worker._ftServing || worker._ftMovingToUser || worker.phase === 'walk') return;

    const dept = session.room || 'general';
    const pool = FERMAT_IDLE_QUOTES[dept] || FERMAT_IDLE_QUOTES.general;
    const text = pool[Math.floor(Math.random() * pool.length)];

    worker.say('idle', text);
  }

  /**
   * 5. LẮNG NGHE SỰ KIỆN TỪ HOST
   */
  function setupMessageListeners() {
    window.addEventListener('message', (ev) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'ft-office:callBot':
          callBotToUserDesk(data.targetDesk, data.requesterName);
          break;
        case 'ft-office:releaseBot':
          releaseActiveBot();
          break;
        case 'ft-office:triggerPatrol':
          triggerDirectorPatrol();
          break;
        case 'ft-office:queryState':
          broadcastQueueState();
          break;
        case 'ft-office:switchView':
          if (data.view) {
            const segBtn = document.querySelector(`.seg-btn[data-view="${data.view}"]`);
            if (segBtn) segBtn.click();
          }
          break;
      }
    });
  }

  // Khởi động
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
