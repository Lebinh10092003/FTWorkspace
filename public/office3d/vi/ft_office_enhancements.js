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

  console.log('[FT Office] Enhancements v3.0 initializing...');

  // Khi ở chế độ nhúng (embed=1 hoặc trong iframe), ẩn thanh tiêu đề, sidebars và panel rườm rà của template cũ
  function cleanEmbedInterface() {
    const isEmbedded = window.self !== window.top || window.location.search.includes('embed=1');
    if (!isEmbedded) return;
    const style = document.createElement('style');
    style.id = 'ft-office-embed-clean';
    style.textContent = `
      header.topbar,
      aside.side,
      .side-left,
      .side-right,
      #feed,
      .kpis,
      .lp-head,
      .lite,
      .chips {
        display: none !important;
      }
      body, html, #stage-wrap, #stage {
        width: 100% !important;
        height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        overflow: hidden !important;
        background: #020617 !important;
      }
      #stage {
        position: absolute !important;
        inset: 0 !important;
      }
      #stage canvas {
        display: block !important;
        width: 100% !important;
        height: 100% !important;
      }
      .toolbar {
        bottom: 16px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        z-index: 20 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  cleanEmbedInterface();

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

  // Danh sách Bot User IDs nhận từ roster
  const botUserIds = new Set();
  let messageListenersSetup = false;

  // Hàng đợi gọi Robot vật lý
  const botQueue = [];
  let activeBotMission = null;

  // CSS quy chuẩn cho tag và bubble không tràn màn hình trên mobile
  (function injectResponsiveStyles() {
    const styleId = 'ft-office-responsive-styles';
    if (document.getElementById(styleId)) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #stage-wrap,
      #stage,
      #app.is-embed #stage-wrap,
      body.is-embed #stage-wrap {
        width: 100% !important;
        max-width: none !important;
        min-width: 100% !important;
      }
      .labels .tag,
      .tag--boss,
      .tag--on,
      .tag--sub,
      .tag--wait,
      .tag--stuck,
      .tag--lost,
      .tag--me {
        max-width: 145px !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
      .bubble, [class*="bubble"] {
        max-width: 220px !important;
        word-break: break-word !important;
        white-space: normal !important;
        line-height: 1.3 !important;
      }
    `;
    if (document.head) document.head.appendChild(style);
  })();

  function isAssistantBot(id, session) {
    if (!session) return false;
    const strId = id !== undefined && id !== null ? String(id).toLowerCase() : '';
    const sessionId = session.id !== undefined && session.id !== null ? String(session.id).toLowerCase() : '';
    const sessionUserId = session.user_id !== undefined && session.user_id !== null ? String(session.user_id).toLowerCase() : '';
    const name = (session.name || '').toLowerCase();
    const role = (session.role || '').toLowerCase();

    return Boolean(
      session.is_assistant ||
      strId.includes('assistant') ||
      sessionId.includes('assistant') ||
      sessionUserId.includes('assistant') ||
      name.includes('trợ lý') ||
      role.includes('trợ lý') ||
      name.includes('hermes') ||
      role.includes('hermes')
    );
  }

  function isBotSession(id, session, worker) {
    if (!session && !worker) return false;
    const strId = id !== undefined && id !== null ? String(id) : '';
    const sessionId = session?.id !== undefined && session?.id !== null ? String(session.id) : '';
    const sessionUserId = session?.user_id !== undefined && session?.user_id !== null ? String(session.user_id) : '';
    const name = (session?.name || worker?.name || '');
    const role = (session?.role || worker?.role || '');
    return Boolean(
      session?.is_bot ||
      session?.isBot ||
      session?.is_assistant ||
      worker?._ftIsBot ||
      botUserIds.has(strId) ||
      (sessionId && botUserIds.has(sessionId)) ||
      (sessionUserId && botUserIds.has(sessionUserId)) ||
      /bot|ai\b|trợ lý|robot|đăng bài tự động|soạn thảo/i.test(name) ||
      /bot|ai\b|trợ lý/i.test(role) ||
      strId.startsWith('bot-') ||
      strId.startsWith('ft-bot')
    );
  }

  let sharedInvisibleMat = null;
  function getInvisibleMaterial() {
    if (!sharedInvisibleMat && THREE) {
      sharedInvisibleMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        visible: false
      });
    }
    return sharedInvisibleMat;
  }

  function isInsideRobotGroup(obj) {
    let cur = obj;
    while (cur) {
      if (cur.name && cur.name.startsWith('ft_robot_')) return true;
      cur = cur.parent;
    }
    return false;
  }

  function enforceHideHumanMeshes(worker) {
    if (!worker || !worker.P) return;
    const rootTarget = worker.P.spine?.parent || worker.P.root || worker.root;
    if (!rootTarget) return;
    const invMat = getInvisibleMaterial();
    rootTarget.traverse(child => {
      if (child.isMesh && !isInsideRobotGroup(child)) {
        child.visible = false;
        child.castShadow = false;
        child.receiveShadow = false;
        if (invMat && child.material !== invMat) {
          child.material = invMat;
        }
      }
    });
  }

  function init() {
    office = window.__office || {};
    ftOffice = window.__ftOffice || {};
    THREE = office.THREE || ftOffice.THREE || window.THREE;

    if (!THREE || !ftOffice.getWorkers) {
      setTimeout(init, 300);
      return;
    }

    console.log('[FT Office] Dependencies ready. Hooking enhancements v4.0.');

    // 1. Quét biến đổi TOÀN BỘ Bot thành Robot Mech 3D (chạy liên tục để chống rebuild reset)
    upgradeAllBotsToRobotMesh();
    setInterval(upgradeAllBotsToRobotMesh, 800);

    // 2. Chạy vòng lặp thoại ngẫu nhiên chất FermatTech
    setInterval(tickFermatIdleQuotes, 8000);

    // 3. Vòng lặp nhấp nháy mắt, đèn ăng-ten Robot & bảo vệ mesh người luôn ẩn
    setInterval(animateRobotEyes, 350);

    // 4. Giám đốc thường xuyên ngồi ở Quán CF Vân, định kỳ đi tuần tra văn phòng
    buildCafeVanDecorations();
    setInterval(buildCafeVanDecorations, 5000);

    setTimeout(() => {
      if (!isPatrolling) sendDirectorToCafeVan();
    }, 3000);
    setTimeout(() => {
      if (!isPatrolling) triggerDirectorPatrol();
      scheduleNextDirectorPatrol();
    }, 90000);

    // 5. Đảm bảo lắng nghe lệnh điều khiển từ Host (đã gọi sớm khi load script)
    setupMessageListeners();

    // Phơi bày hàm nội bộ
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
   * 1. BIẾN ĐỔI TOÀN BỘ BOT AI THÀNH ROBOT MECH 3D
   */
  function upgradeAllBotsToRobotMesh() {
    if (!ftOffice || !ftOffice.getWorkers || !ftOffice.getSessions) return;
    const workers = ftOffice.getWorkers();
    const sessions = ftOffice.getSessions();

    for (const [id, worker] of workers.entries()) {
      const session = sessions.get(id);
      if (!session) continue;

      const isBot = isBotSession(id, session, worker);

      // Gắn click listener vào tagEl của nhân viên để tương tác xem danh thiếp
      if (worker.tagEl && !worker.tagEl._ftClickBound) {
        worker.tagEl._ftClickBound = true;
        worker.tagEl.style.cursor = 'pointer';
        worker.tagEl.title = 'Bấm để xem thông tin nhân sự';
        worker.tagEl.addEventListener('click', (e) => {
          e.stopPropagation();
          postToParent({
            type: 'ft-office:selectWorker',
            worker: {
              id,
              name: session.name || 'Đồng nghiệp',
              role: session.role || 'Thành viên',
              room: session.room,
              desk: worker.desk,
              isIdle: !!worker._ftIsIdle,
              isBot
            }
          });
        });
      }

      if (isBot && worker.P && worker.P.head) {
        worker._ftIsBot = true;
        // Nếu worker.P vừa bị engine rebuild lại từ đầu, reset cờ để nâng cấp lại ngay
        if (worker._ftLastP !== worker.P) {
          worker._ftRobotUpgraded = false;
        }
        if (!worker._ftRobotUpgraded) {
          transformWorkerToRobot(worker, session);
        } else {
          enforceHideHumanMeshes(worker);
        }
      }
    }
  }

  function getRobotTheme(session) {
    const name = (session?.name || '').toLowerCase();
    if (name.includes('đăng bài')) {
      return {
        chassis: '#334155',
        armor: '#1E293B',
        accent: '#A855F7',
        visor: '#E879F9',
        reactor: '#C084FC',
        beacon: '#EC4899',
        tagColor: '#C084FC',
        label: 'Robot AI Xuất bản'
      };
    }
    if (name.includes('soạn thảo') || name.includes('biên tập')) {
      return {
        chassis: '#E2E8F0',
        armor: '#CBD5E1',
        accent: '#10B981',
        visor: '#34D399',
        reactor: '#10B981',
        beacon: '#84CC16',
        tagColor: '#10B981',
        label: 'Robot AI Biên tập'
      };
    }
    if (name.includes('khảo thí') || name.includes('đề thi') || name.includes('chuyên viên')) {
      return {
        chassis: '#1E293B',
        armor: '#334155',
        accent: '#F59E0B',
        visor: '#FBBF24',
        reactor: '#F59E0B',
        beacon: '#F59E0B',
        tagColor: '#F59E0B',
        label: 'Robot AI Khảo thí'
      };
    }
    // Robot Trợ lý AI mặc định
    return {
      chassis: '#E2E8F0',
      armor: '#F8FAFC',
      accent: '#0EA5E9',
      visor: '#00F0FF',
      reactor: '#38BDF8',
      beacon: '#F59E0B',
      tagColor: '#00F0FF',
      label: 'Robot Trợ lý AI'
    };
  }

  function transformWorkerToRobot(worker, session) {
    try {
      if (typeof THREE === 'undefined' || !worker.P?.head || !worker.P?.spine) return;

      const theme = getRobotTheme(session);

      // Dọn dẹp mesh robot cũ nếu có sau rebuild
      const rootTarget = worker.P.spine.parent || worker.P.root || worker.root;
      if (rootTarget) {
        const oldGroups = [];
        rootTarget.traverse(obj => {
          if (obj.name && obj.name.startsWith('ft_robot_')) {
            oldGroups.push(obj);
          }
        });
        oldGroups.forEach(g => g.parent && g.parent.remove(g));
      }

      const titaniumMat = new THREE.MeshStandardMaterial({
        color: theme.chassis,
        metalness: 0.78,
        roughness: 0.20
      });
      const slateArmorMat = new THREE.MeshStandardMaterial({
        color: theme.armor,
        metalness: 0.55,
        roughness: 0.18
      });
      const darkVisorBgMat = new THREE.MeshStandardMaterial({
        color: '#090D16',
        metalness: 0.9,
        roughness: 0.1
      });
      const accentMat = new THREE.MeshStandardMaterial({
        color: theme.accent,
        metalness: 0.65,
        roughness: 0.25
      });
      const neonVisorMat = new THREE.MeshStandardMaterial({
        color: theme.visor,
        emissive: theme.visor,
        emissiveIntensity: 2.5,
        roughness: 0.1
      });
      const reactorMat = new THREE.MeshStandardMaterial({
        color: theme.reactor,
        emissive: theme.visor,
        emissiveIntensity: 2.6,
        roughness: 0.1
      });

      // 1. Gắn vào worker.P.head: Đầu Robot Mech vuông bo góc, mặt kính đen, Visor LED neon, 2 ăng-ten beacon
      if (worker.P?.head) {
        const headGroup = new THREE.Group();
        headGroup.name = 'ft_robot_head_mech';

        const helmetGeo = new THREE.BoxGeometry(0.32, 0.28, 0.30);
        const helmetMesh = new THREE.Mesh(helmetGeo, slateArmorMat);
        helmetMesh.position.set(0, 0.02, 0);
        helmetMesh.castShadow = true;
        headGroup.add(helmetMesh);

        // Khung mặt kính đen phía trước
        const faceScreenGeo = new THREE.BoxGeometry(0.26, 0.16, 0.03);
        const faceScreen = new THREE.Mesh(faceScreenGeo, darkVisorBgMat);
        faceScreen.position.set(0, 0.015, 0.142);
        headGroup.add(faceScreen);

        // 2 mắt LED neon phát sáng trong màn hình mặt
        const eyeGeo = new THREE.BoxGeometry(0.07, 0.05, 0.02);
        const leftEye = new THREE.Mesh(eyeGeo, neonVisorMat);
        leftEye.position.set(-0.06, 0.02, 0.155);
        const rightEye = new THREE.Mesh(eyeGeo, neonVisorMat);
        rightEye.position.set(0.06, 0.02, 0.155);
        headGroup.add(leftEye, rightEye);

        // 2 tai cảm biến trụ tròn 2 bên
        const earGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.05, 16);
        earGeo.rotateZ(Math.PI / 2);
        const leftEar = new THREE.Mesh(earGeo, accentMat);
        leftEar.position.set(-0.17, 0.02, 0);
        const rightEar = new THREE.Mesh(earGeo, accentMat);
        rightEar.position.set(0.17, 0.02, 0);
        headGroup.add(leftEar, rightEar);

        // 2 ăng-ten đỉnh đầu kèm đèn beacon nhấp nháy
        const antPoleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.13, 8);
        const leftPole = new THREE.Mesh(antPoleGeo, titaniumMat);
        leftPole.position.set(-0.09, 0.21, 0);
        const rightPole = new THREE.Mesh(antPoleGeo, titaniumMat);
        rightPole.position.set(0.09, 0.21, 0);
        headGroup.add(leftPole, rightPole);

        const beaconGeo = new THREE.SphereGeometry(0.024, 12, 10);
        const beaconMat = new THREE.MeshStandardMaterial({
          color: theme.beacon,
          emissive: theme.beacon,
          emissiveIntensity: 2.2,
          roughness: 0.1
        });
        const leftBeacon = new THREE.Mesh(beaconGeo, beaconMat);
        leftBeacon.position.set(-0.09, 0.28, 0);
        const rightBeacon = new THREE.Mesh(beaconGeo, beaconMat);
        rightBeacon.position.set(0.09, 0.28, 0);
        headGroup.add(leftBeacon, rightBeacon);

        worker.P.head.add(headGroup);
        worker._ftBeaconMat = beaconMat;
        worker._ftVisorMat = neonVisorMat;
        worker._ftTheme = theme;
      }

      // 2. Gắn vào worker.P.spine (KHÔNG gắn vào worker.P.torso vốn là Mesh sẽ bị ẩn):
      // Khối giáp ngực Mech, cổ robot, 2 vai Pauldrons, Arc Reactor, Jetpack
      if (worker.P?.spine) {
        const torsoGroup = new THREE.Group();
        torsoGroup.name = 'ft_robot_torso_mech';

        // Trụ cổ robot
        const neckGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.12, 14);
        const neckMesh = new THREE.Mesh(neckGeo, titaniumMat);
        neckMesh.position.set(0, 0.56, 0);
        torsoGroup.add(neckMesh);

        // Khối giáp ngực Mech đặt đúng tâm thân (y ~ 0.26 trên spine)
        const chestGeo = new THREE.BoxGeometry(0.38, 0.44, 0.26);
        const chestMesh = new THREE.Mesh(chestGeo, titaniumMat);
        chestMesh.position.set(0, 0.25, 0);
        chestMesh.castShadow = true;
        torsoGroup.add(chestMesh);

        // Đai eo cơ khí
        const waistGeo = new THREE.BoxGeometry(0.30, 0.10, 0.22);
        const waistMesh = new THREE.Mesh(waistGeo, darkVisorBgMat);
        waistMesh.position.set(0, 0.02, 0);
        torsoGroup.add(waistMesh);

        // 2 giáp vai Pauldrons nhô lên 2 bên
        const pauldronGeo = new THREE.BoxGeometry(0.13, 0.11, 0.28);
        const leftPauldron = new THREE.Mesh(pauldronGeo, slateArmorMat);
        leftPauldron.position.set(-0.22, 0.43, 0);
        leftPauldron.rotation.z = -0.18;
        leftPauldron.castShadow = true;
        const rightPauldron = new THREE.Mesh(pauldronGeo, slateArmorMat);
        rightPauldron.position.set(0.22, 0.43, 0);
        rightPauldron.rotation.z = 0.18;
        rightPauldron.castShadow = true;
        torsoGroup.add(leftPauldron, rightPauldron);

        // Lõi Arc Reactor tròn ở chính giữa ngực
        const reactorGroup = new THREE.Group();
        reactorGroup.position.set(0, 0.29, 0.14);

        const ringGeo = new THREE.TorusGeometry(0.058, 0.014, 16, 24);
        const ringMesh = new THREE.Mesh(ringGeo, accentMat);

        const coreGeo = new THREE.CylinderGeometry(0.044, 0.044, 0.018, 24);
        coreGeo.rotateX(Math.PI / 2);
        const coreMesh = new THREE.Mesh(coreGeo, reactorMat);
        reactorGroup.add(ringMesh, coreMesh);
        torsoGroup.add(reactorGroup);

        // Khối Jetpack năng lượng sau lưng kèm 2 ống xả phát sáng
        const jetpackGroup = new THREE.Group();
        jetpackGroup.position.set(0, 0.26, -0.17);

        const packGeo = new THREE.BoxGeometry(0.26, 0.30, 0.10);
        const packMesh = new THREE.Mesh(packGeo, slateArmorMat);
        packMesh.castShadow = true;
        jetpackGroup.add(packMesh);

        const nozzleGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.09, 16);
        const leftNozzle = new THREE.Mesh(nozzleGeo, titaniumMat);
        leftNozzle.position.set(-0.075, -0.13, 0);
        const rightNozzle = new THREE.Mesh(nozzleGeo, titaniumMat);
        rightNozzle.position.set(0.075, -0.13, 0);

        const exhaustGeo = new THREE.CylinderGeometry(0.025, 0.01, 0.05, 16);
        const leftExhaust = new THREE.Mesh(exhaustGeo, reactorMat);
        leftExhaust.position.set(-0.075, -0.19, 0);
        const rightExhaust = new THREE.Mesh(exhaustGeo, reactorMat);
        rightExhaust.position.set(0.075, -0.19, 0);

        jetpackGroup.add(leftNozzle, rightNozzle, leftExhaust, rightExhaust);
        torsoGroup.add(jetpackGroup);

        worker.P.spine.add(torsoGroup);
        worker._ftReactorMat = reactorMat;
      }

      // 3. Gắn vào worker.P.armL.sh / el và worker.P.armR.sh / el: Ống giáp cánh tay cơ khí và càng kẹp bàn tay robot
      function buildUpperArmArmor() {
        const grp = new THREE.Group();
        grp.name = 'ft_robot_arm_upper';
        const armorGeo = new THREE.BoxGeometry(0.11, 0.18, 0.11);
        const armorMesh = new THREE.Mesh(armorGeo, titaniumMat);
        armorMesh.position.set(0, -0.09, 0);
        armorMesh.castShadow = true;

        const trimGeo = new THREE.BoxGeometry(0.125, 0.045, 0.125);
        const trimMesh = new THREE.Mesh(trimGeo, accentMat);
        trimMesh.position.set(0, -0.04, 0);

        grp.add(armorMesh, trimMesh);
        return grp;
      }

      function buildForearmAndClaw() {
        const grp = new THREE.Group();
        grp.name = 'ft_robot_arm_lower';
        const armGeo = new THREE.BoxGeometry(0.10, 0.16, 0.10);
        const armMesh = new THREE.Mesh(armGeo, slateArmorMat);
        armMesh.position.set(0, -0.08, 0);
        armMesh.castShadow = true;

        const wristGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.035, 12);
        const wristMesh = new THREE.Mesh(wristGeo, titaniumMat);
        wristMesh.position.set(0, -0.17, 0);

        const clawGeo = new THREE.BoxGeometry(0.022, 0.06, 0.035);
        const leftClaw = new THREE.Mesh(clawGeo, accentMat);
        leftClaw.position.set(-0.028, -0.21, 0);
        const rightClaw = new THREE.Mesh(clawGeo, accentMat);
        rightClaw.position.set(0.028, -0.21, 0);

        grp.add(armMesh, wristMesh, leftClaw, rightClaw);
        return grp;
      }

      if (worker.P?.armL?.sh) worker.P.armL.sh.add(buildUpperArmArmor());
      if (worker.P?.armR?.sh) worker.P.armR.sh.add(buildUpperArmArmor());
      if (worker.P?.armL?.el) worker.P.armL.el.add(buildForearmAndClaw());
      if (worker.P?.armR?.el) worker.P.armR.el.add(buildForearmAndClaw());

      // 4. Gắn vào worker.P.legL.hip / knee và worker.P.legR.hip / knee: Giáp ống chân mech
      function buildThighArmor() {
        const grp = new THREE.Group();
        grp.name = 'ft_robot_thigh';
        const thighGeo = new THREE.BoxGeometry(0.13, 0.22, 0.13);
        const thighMesh = new THREE.Mesh(thighGeo, titaniumMat);
        thighMesh.position.set(0, -0.11, 0);
        thighMesh.castShadow = true;

        const kneeCapGeo = new THREE.BoxGeometry(0.11, 0.06, 0.04);
        const kneeCapMesh = new THREE.Mesh(kneeCapGeo, accentMat);
        kneeCapMesh.position.set(0, -0.20, 0.07);

        grp.add(thighMesh, kneeCapMesh);
        return grp;
      }

      function buildShinArmor() {
        const grp = new THREE.Group();
        grp.name = 'ft_robot_shin';
        const shinGeo = new THREE.BoxGeometry(0.12, 0.22, 0.13);
        const shinMesh = new THREE.Mesh(shinGeo, slateArmorMat);
        shinMesh.position.set(0, -0.11, 0);
        shinMesh.castShadow = true;

        const footGeo = new THREE.BoxGeometry(0.13, 0.065, 0.19);
        const footMesh = new THREE.Mesh(footGeo, titaniumMat);
        footMesh.position.set(0, -0.22, 0.03);
        footMesh.castShadow = true;

        grp.add(shinMesh, footMesh);
        return grp;
      }

      if (worker.P?.legL?.hip) worker.P.legL.hip.add(buildThighArmor());
      if (worker.P?.legR?.hip) worker.P.legR.hip.add(buildThighArmor());
      if (worker.P?.legL?.knee) worker.P.legL.knee.add(buildShinArmor());
      if (worker.P?.legR?.knee) worker.P.legR.knee.add(buildShinArmor());

      // 5. Đĩa đệm phản lực Hover Repulsor Ring dưới chân
      if (rootTarget) {
        const repulsorGroup = new THREE.Group();
        repulsorGroup.name = 'ft_robot_repulsor';

        const repulsorMat = new THREE.MeshBasicMaterial({
          color: theme.visor,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide
        });

        const torusGeo = new THREE.TorusGeometry(0.28, 0.016, 12, 36);
        torusGeo.rotateX(Math.PI / 2);
        const torusMesh = new THREE.Mesh(torusGeo, repulsorMat);
        torusMesh.position.set(0, 0.04, 0);

        const ringGeo = new THREE.RingGeometry(0.18, 0.27, 32);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: theme.visor,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(0, 0.04, 0);

        repulsorGroup.add(torusMesh, ringMesh);
        rootTarget.add(repulsorGroup);

        worker._ftRepulsorMat = repulsorMat;
        worker._ftRepulsorDiscMat = ringMat;
      }

      // Ẩn triệt để TOÀN BỘ mesh người cũ (bao gồm tóc, mặt, mắt, cổ, áo, thân, tay, chân)
      enforceHideHumanMeshes(worker);

      worker._ftLastP = worker.P;
      worker._ftRobotUpgraded = true;

      // Cập nhật tag hiển thị trên đầu
      if (worker.tagDot) {
        worker.tagDot.style.background = theme.tagColor;
        worker.tagDot.style.boxShadow = `0 0 10px ${theme.tagColor}`;
      }
      if (worker.tagEl) {
        worker.tagEl.title = `[${theme.label}] ${session.name}`;
      }

      console.log(`[FT Office] Transformed bot ${session.name} (${session.id}) -> 3D Mech Robot (${theme.label})`);
    } catch (err) {
      console.warn('[FT Office] Failed to transform bot:', err);
    }
  }

  function animateRobotEyes() {
    const t = Date.now() / 300;
    const pulse = (Math.sin(t) + 1) / 2;

    if (ftOffice && ftOffice.getWorkers) {
      const workers = ftOffice.getWorkers();
      workers.forEach(w => {
        if (w._ftIsBot && w._ftRobotUpgraded) {
          enforceHideHumanMeshes(w);
        }
        if (w._ftBeaconMat) {
          const bright = pulse > 0.4;
          const activeColor = w._ftTheme?.beacon || '#F59E0B';
          const color = bright ? (w._ftServing ? '#10B981' : activeColor) : '#451A03';
          w._ftBeaconMat.color.set(color);
          w._ftBeaconMat.emissive.set(color);
        }
        if (w._ftRepulsorMat) {
          w._ftRepulsorMat.opacity = 0.35 + 0.45 * pulse;
        }
        if (w._ftRepulsorDiscMat) {
          w._ftRepulsorDiscMat.opacity = 0.12 + 0.25 * pulse;
        }
        if (w._ftReactorMat) {
          w._ftReactorMat.emissiveIntensity = 1.8 + 1.2 * pulse;
        }
        if (w._ftVisorMat && Math.random() < 0.08) {
          w._ftVisorMat.emissiveIntensity = 0.25;
          setTimeout(() => {
            if (w._ftVisorMat) w._ftVisorMat.emissiveIntensity = 2.5;
          }, 120);
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
    if (!ftOffice || !ftOffice.getWorkers || !ftOffice.getSessions) return null;
    const workers = ftOffice.getWorkers();
    const sessions = ftOffice.getSessions();

    // Chỉ gọi Robot Trợ lý AI chuyên trách (KHÔNG gọi bot phòng Khảo thí)
    for (const [id, worker] of workers.entries()) {
      const session = sessions.get(id);
      if (!session) continue;
      if (isAssistantBot(id, session) && !worker._ftServing && !worker._ftMovingToUser && !worker.leaving) {
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
   * 3. GIÁM ĐỐC TỰ ĐỘNG TUẦN TRA ĐA PHÒNG & NHÂN VIÊN VỘI VÃ CHẠY VỀ BÀN
   */
  function scheduleNextDirectorPatrol() {
    const delay = 120000 + Math.random() * 60000; // 120s - 180s mới đi tuần tra 1 lần
    setTimeout(() => {
      if (!isPatrolling) {
        triggerDirectorPatrol();
      }
      scheduleNextDirectorPatrol();
    }, delay);
  }

  function makeNodeWaypoint(nodes, nodeKeys, face, text) {
    for (const key of nodeKeys) {
      if (nodes && Array.isArray(nodes[key])) {
        const [nx, nz] = nodes[key];
        return { x: nx, z: nz, node: key, face, sit: false, text };
      }
    }
    return null;
  }

  function triggerDirectorPatrol() {
    const director = ftOffice.getDirector ? ftOffice.getDirector() : null;
    if (!director || isPatrolling || director.offstage) return;

    const nav = ftOffice.getNav ? ftOffice.getNav() : null;
    const nodes = nav?.NODES || {};

    isPatrolling = true;
    console.log('[FT Office] Director autonomous multi-room patrol started!');

    // Giữ director.job và station='rounds' để director.tick() không tự động kéo Sếp về bàn giữa chừng
    director.job = { stage: 'patrol', sess: '__patrol' };
    director.station = 'rounds';
    director.pose = 'stand';
    director.hush && director.hush();
    director.say('prompt', '📋 Đi dạo một vòng kiểm tra các phòng ban xem anh em làm việc thế nào!');

    // Kích hoạt hiệu ứng nhân viên đang giải lao hốt hoảng chạy về bàn
    triggerRushToDesk();

      // Lộ trình đi vào TẤT CẢ các phòng trong văn phòng qua graph NODES chuẩn
    const patrolWaypoints = [
      makeNodeWaypoint(nodes, ['MF1', 'MTi'], Math.PI, 'Phòng họp FermatTech: thiết bị & lịch họp chuẩn bị sẵn sàng chưa? 👥'),
      makeNodeWaypoint(nodes, ['LBm', 'LBi'], Math.PI / 2, 'Studio AI & Thư viện: tiến độ sáng tạo nội dung thế nào rồi? 🎨'),
      makeNodeWaypoint(nodes, ['P0b0', 'M1'], 0, 'Phòng chung: mọi người tập trung cao độ nhé! 💻'),
      makeNodeWaypoint(nodes, ['D0i', 'D0b'], 0, 'Vào kiểm tra Phòng Công nghệ: server và code chạy ổn định chứ các bạn? ⚡'),
      makeNodeWaypoint(nodes, ['D1i', 'D1b'], 0, 'Vào kiểm tra Phòng Khảo thí: ngân hàng đề thi bảo mật tốt nhé! 📝'),
      makeNodeWaypoint(nodes, ['D2i', 'D2b'], 0, 'Vào kiểm tra Kế toán & HR: đối soát sổ sách & nhân sự đúng hạn nhé! 💵'),
      makeNodeWaypoint(nodes, ['D3i', 'D3b'], 0, 'Ghé thăm Phòng Truyền thông: chiến dịch media & nội dung tiến triển tốt chứ? 📣'),
      makeNodeWaypoint(nodes, ['PA1', 'PA4'], -Math.PI / 2, 'Khu Pantry: giải lao uống nước xong nhớ quay lại bàn làm việc nhé! ☕'),
      makeNodeWaypoint(nodes, ['LG1', 'LG3'], -Math.PI / 2, 'Khu giải lao Lounge: hết giờ nghỉ rồi, ai đang thư giãn mau về chỗ! 🎮'),
      director.homeSpot ? director.homeSpot() : { x: -5.4, z: -6.75, node: 'DRs', face: 0, sit: true }
    ].filter(Boolean);

    if (patrolWaypoints.length === 0) {
      isPatrolling = false;
      director.job = null;
      director.station = 'home';
      return;
    }

    runPatrolChain(director, patrolWaypoints, 0);
  }

  function triggerRushToDesk() {
    if (!ftOffice.getWorkers || !ftOffice.getSessions) return;
    const workers = ftOffice.getWorkers();
    const sessions = ftOffice.getSessions();

    workers.forEach((worker, id) => {
      const session = sessions.get(id);
      if (!session) return;
      if (session.room === 'director' || worker._ftIsBot || isBotSession(id, session, worker)) return;

      // Bất kỳ nhân viên nào đang giải lao, đi loanh quanh, uống cà phê, hoặc không ngồi tại bàn
      const isRelaxing =
        worker.station !== 'desk' ||
        worker.pose !== 'sit' ||
        worker.phase === 'walk' ||
        Boolean(worker.want) ||
        Boolean(worker._ftIsIdle);

      if (isRelaxing && worker.homeSpot) {
        worker.want = null;
        worker.chore = null;
        worker.queued = false;
        worker.ftNext = (window.__office?.sim || 0) + 45;

        const panicLine = RUSH_QUOTES[Math.floor(Math.random() * RUSH_QUOTES.length)];
        worker.say('idle', panicLine);

        if (!worker._ftOrigSpeed) worker._ftOrigSpeed = worker.speed || 1;
        worker.speed = Math.max(2.8, worker._ftOrigSpeed * 2.6);

        const home = worker.homeSpot();
        worker.goTo(home, () => {
          worker.speed = worker._ftOrigSpeed || 1;
          worker.station = 'desk';
          worker.pose = home.sit ? 'sit' : 'stand';
          worker.anim = 'type';
          worker.say('idle', 'Tập trung làm việc... 💻');
        });
      } else if (worker.station === 'desk') {
        worker.anim = 'type';
      }
    });
  }

  let cafeVanAnchor = { x: -13.2, z: 17.8 };
  let cafeVanChairSpot = { x: -12.9, z: 17.3, face: Math.PI * 0.25 };

  function findSceneRoot() {
    if (office && office.scene) return office.scene;
    if (ftOffice && ftOffice.scene) return ftOffice.scene;
    if (ftOffice && ftOffice.getWorkers) {
      const workers = ftOffice.getWorkers();
      if (workers) {
        for (const w of workers.values()) {
          if (w && w.mesh) {
            let cur = w.mesh;
            while (cur.parent) cur = cur.parent;
            if (cur && cur.isScene) return cur;
          }
        }
      }
    }
    return null;
  }

  function buildCafeVanDecorations() {
    if (!THREE) return;
    const scene = findSceneRoot();
    if (!scene) return;

    // Nếu đã dựng rồi thì không dựng lại trùng lặp
    const existingGroup = scene.getObjectByName('ft_cafe_van_group');
    if (existingGroup && existingGroup.userData && existingGroup.userData.version === 'v2_building') {
      return;
    }
    if (existingGroup) {
      scene.remove(existingGroup);
    }

    // Dò tìm tòa nhà mặt tiền có biển hiệu cam ở góc phố ngoài trời
    let detectedMesh = null;
    let bestDist = Infinity;
    let detectedWp = new THREE.Vector3(-13.5, 3.1, 18.5);
    let signSize = new THREE.Vector3(3.6, 1.1, 0.2);
    let signCenter = new THREE.Vector3(-13.5, 3.1, 18.5);

    try {
      scene.traverse((obj) => {
        if (!obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m || !m.color) continue;
          const r = m.color.r, g = m.color.g, b = m.color.b;
          // Biển hiệu cam của căn nhà góc phố ngoài trời
          if (r > 0.65 && g > 0.22 && g < 0.62 && b < 0.3) {
            const wp = new THREE.Vector3();
            obj.getWorldPosition(wp);
            if (wp.x < -7 && wp.z > 8 && wp.z < 28 && wp.y > 0.5 && wp.y < 6) {
              const dist = Math.hypot(wp.x + 13, wp.z - 18);
              if (dist < bestDist) {
                bestDist = dist;
                detectedMesh = obj;
                detectedWp.copy(wp);
              }
            }
          }
        }
      });
    } catch (e) {}

    if (detectedMesh) {
      try {
        const box = new THREE.Box3().setFromObject(detectedMesh);
        box.getSize(signSize);
        box.getCenter(signCenter);
      } catch (e) {
        signCenter.copy(detectedWp);
      }
    }

    cafeVanAnchor = { x: signCenter.x, z: signCenter.z };

    // Tạo canvas texture biển hiệu "QUÁN CF VÂN" tone cà phê ấm cúng, sang trọng
    const signCanvas = document.createElement('canvas');
    signCanvas.width = 1024;
    signCanvas.height = 256;
    const sctx = signCanvas.getContext('2d');
    sctx.fillStyle = '#26140A';
    sctx.fillRect(0, 0, 1024, 256);
    sctx.strokeStyle = '#D97706';
    sctx.lineWidth = 14;
    sctx.strokeRect(10, 10, 1004, 236);
    sctx.strokeStyle = '#78350F';
    sctx.lineWidth = 4;
    sctx.strokeRect(26, 26, 972, 204);
    sctx.fillStyle = '#FEF3C7';
    sctx.font = 'bold 88px sans-serif';
    sctx.textAlign = 'center';
    sctx.fillText('☕ QUÁN CF VÂN', 512, 118);
    sctx.fillStyle = '#FCD34D';
    sctx.font = '600 36px sans-serif';
    sctx.fillText('CÀ PHÊ NGUYÊN CHẤT • TRÀ • ĐỒ UỐNG', 512, 192);

    const signTex = new THREE.CanvasTexture(signCanvas);
    if (THREE.SRGBColorSpace) signTex.colorSpace = THREE.SRGBColorSpace;

    // 1. Sửa trực tiếp biển hiệu của căn nhà hiện hữu thành Quán CF Vân
    if (detectedMesh) {
      try {
        detectedMesh.material = new THREE.MeshStandardMaterial({
          map: signTex,
          roughness: 0.35,
          metalness: 0.1,
          side: THREE.DoubleSide
        });
        if (detectedMesh.material.map) detectedMesh.material.map.needsUpdate = true;
        detectedMesh.material.needsUpdate = true;
      } catch (e) {}
    }

    const group = new THREE.Group();
    group.name = 'ft_cafe_van_group';
    group.userData = { version: 'v2_building' };

    // 2. Gắn biển hiệu nổi 3D ép khít vào mặt tiền căn nhà (CHỈ KHI tìm thấy mesh mặt tiền)
    if (detectedMesh) {
      const isXAligned = signSize.x >= signSize.z;
      const signWidth = Math.max(isXAligned ? signSize.x : signSize.z, 3.2);
      const signHeight = Math.max(signSize.y, 0.95);
      const signBoardMat = [
        new THREE.MeshStandardMaterial({ color: 0x26140a, roughness: 0.7 }),
        new THREE.MeshStandardMaterial({ color: 0x26140a, roughness: 0.7 }),
        new THREE.MeshStandardMaterial({ color: 0x26140a, roughness: 0.7 }),
        new THREE.MeshStandardMaterial({ color: 0x26140a, roughness: 0.7 }),
        new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.35, metalness: 0.1 }),
        new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.35, metalness: 0.1 })
      ];

      const signBoard = new THREE.Mesh(
        new THREE.BoxGeometry(
          isXAligned ? signWidth : 0.08,
          signHeight,
          isXAligned ? 0.08 : signWidth
        ),
        signBoardMat
      );
      signBoard.position.set(
        signCenter.x + (isXAligned ? 0 : 0.06),
        signCenter.y,
        signCenter.z + (isXAligned ? -0.06 : 0)
      );
      group.add(signBoard);

      const signLight = new THREE.PointLight(0xfde68a, 1.1, 7);
      signLight.position.set(
        signCenter.x + (isXAligned ? 0 : 0.4),
        signCenter.y + 0.35,
        signCenter.z + (isXAligned ? -0.4 : 0)
      );
      group.add(signLight);
    }

    // 3. Bố trí bàn ghế cafe trên vỉa hè SÁT VÁCH CĂN NHÀ (không lấn ra lòng đường!)
    const isXAligned = signSize.x >= signSize.z;
    const sidewalkX = detectedMesh ? (signCenter.x + (isXAligned ? 0.3 : 0.65)) : -12.5;
    const sidewalkZ = detectedMesh ? (signCenter.z - (isXAligned ? 0.75 : 0.3)) : 17.5;

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b3a19, roughness: 0.6 });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.6 });
    const cupMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
    const coffeeMat = new THREE.MeshStandardMaterial({ color: 0x3b1f0b, roughness: 0.1 });
    const potMat = new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.8 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.7 });

    const cafeTableGroup = new THREE.Group();
    cafeTableGroup.position.set(sidewalkX, 0, sidewalkZ);

    // Bàn cafe tròn nhỏ xinh xắn trên vỉa hè
    const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 10), metalMat);
    tableLeg.position.y = 0.35;
    cafeTableGroup.add(tableLeg);

    const tableBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.03, 14), metalMat);
    tableBase.position.y = 0.015;
    cafeTableGroup.add(tableBase);

    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.04, 18), woodMat);
    tableTop.position.y = 0.71;
    cafeTableGroup.add(tableTop);

    // Tách cafe trên bàn
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.015, 12), cupMat);
    saucer.position.set(0.05, 0.74, 0.02);
    cafeTableGroup.add(saucer);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.038, 0.075, 12), cupMat);
    cup.position.set(0.05, 0.78, 0.02);
    cafeTableGroup.add(cup);
    const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.01, 10), coffeeMat);
    liq.position.set(0.05, 0.815, 0.02);
    cafeTableGroup.add(liq);

    // Ghế của Giám đốc (ngồi sát vách quán nhìn ra ngã tư)
    const directorChairOffset = { x: -0.42, z: 0.15 };
    const chairSeat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.035, 12), woodMat);
    chairSeat.position.set(directorChairOffset.x, 0.44, directorChairOffset.z);
    cafeTableGroup.add(chairSeat);

    const chairLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.43, 8), metalMat);
    chairLeg.position.set(directorChairOffset.x, 0.215, directorChairOffset.z);
    cafeTableGroup.add(chairLeg);

    const chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.32, 0.28), woodMat);
    chairBack.position.set(directorChairOffset.x - 0.14, 0.58, directorChairOffset.z);
    chairBack.rotation.y = 0.15;
    cafeTableGroup.add(chairBack);

    // Ghế đối diện phụ
    const guestChairOffset = { x: 0.42, z: -0.12 };
    const gSeat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.035, 12), woodMat);
    gSeat.position.set(guestChairOffset.x, 0.44, guestChairOffset.z);
    cafeTableGroup.add(gSeat);

    const gLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.43, 8), metalMat);
    gLeg.position.set(guestChairOffset.x, 0.215, guestChairOffset.z);
    cafeTableGroup.add(gLeg);

    // 1 chậu cây cảnh nhỏ đặt ở góc vỉa hè sát chân tường quán
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.36, 12), potMat);
    pot.position.set(sidewalkX - 1.2, 0.18, sidewalkZ + 0.3);
    group.add(pot);
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), leafMat);
    bush.position.set(sidewalkX - 1.2, 0.55, sidewalkZ + 0.3);
    group.add(bush);

    // Dù che nắng quán cà phê màu kem trang nhã
    const umbrellaPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 10), metalMat);
    umbrellaPole.position.set(-0.35, 1.1, -0.35);
    cafeTableGroup.add(umbrellaPole);

    const umbrellaCanopy = new THREE.Mesh(
      new THREE.ConeGeometry(0.95, 0.42, 16),
      new THREE.MeshStandardMaterial({ color: 0xF3E8D6, roughness: 0.8, side: THREE.DoubleSide })
    );
    umbrellaCanopy.position.set(-0.35, 2.1, -0.35);
    cafeTableGroup.add(umbrellaCanopy);

    // Bảng đen menu chữ A đặt trên vỉa hè
    const menuBoardMat = new THREE.MeshStandardMaterial({ color: 0x1E293B, roughness: 0.9 });
    const menuFrameMat = new THREE.MeshStandardMaterial({ color: 0x78350F, roughness: 0.7 });
    const aFrame = new THREE.Group();
    aFrame.position.set(sidewalkX + 0.85, 0, sidewalkZ - 0.35);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.75, 0.04), menuFrameMat);
    legL.position.set(-0.2, 0.36, 0);
    legL.rotation.z = -0.08;
    const legR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.75, 0.04), menuFrameMat);
    legR.position.set(0.2, 0.36, 0);
    legR.rotation.z = 0.08;
    const boardPanel = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 0.02), menuBoardMat);
    boardPanel.position.set(0, 0.38, 0);
    aFrame.add(legL, legR, boardPanel);
    group.add(aFrame);

    group.add(cafeTableGroup);

    // Lưu điểm ngồi chính xác của Giám đốc trên vỉa hè
    cafeVanChairSpot = {
      x: sidewalkX + directorChairOffset.x,
      z: sidewalkZ + directorChairOffset.z,
      face: Math.PI * 0.22
    };

    scene.add(group);
  }

  function getCafeVanSpot() {
    return {
      x: cafeVanChairSpot.x,
      y: 0,
      z: cafeVanChairSpot.z,
      face: cafeVanChairSpot.face,
      sit: true
    };
  }

  function sendDirectorToCafeVan() {
    const director = ftOffice && ftOffice.getDirector ? ftOffice.getDirector() : null;
    if (!director || isPatrolling || director.offstage) return;
    const cf = getCafeVanSpot();

    // Chuỗi điểm di chuyển an toàn từ văn phòng ra Quán CF Vân ngoài trời (tránh đâm xuyên tường)
    const exitPath = [
      { x: -3.1, z: -2.3, node: 'L0' },   // Cửa phòng Giám đốc ra hành lang
      { x: -2.4, z: 3.3, node: 'L2' },    // Hành lang trung tâm
      { x: -2.4, z: 8.4, node: 'L4' },    // Cửa chính văn phòng
      { x: -2.4, z: 10.5 },               // Bước ra sảnh vỉa hè ngoài trời
      { x: -7.5, z: 14.5 },               // Đi dọc vỉa hè về góc ngã tư
      { x: cf.x, z: cf.z, face: cf.face, sit: true } // Ghế vỉa hè Quán CF Vân
    ];

    let step = 0;
    director.job = { stage: 'cafe', sess: '__cafe_van' };
    director.station = 'cafe';
    director.pose = 'stand';
    director.anim = 'walk';

    function nextStep() {
      if (isPatrolling || !director.job || director.job.sess !== '__cafe_van') return;
      if (step >= exitPath.length) {
        director.pose = 'sit';
        director.anim = 'coffee';
        if (typeof director.say === 'function') {
          director.say('idle', '☕ Ngồi Quán CF Vân làm ly cà phê, điều hành công việc từ xa!');
        }
        return;
      }

      const target = exitPath[step];
      step++;
      let reached = false;
      const stepTimer = setTimeout(() => {
        if (!reached && !isPatrolling && director.job?.sess === '__cafe_van') {
          reached = true;
          if (director.pos && target.x !== undefined && target.z !== undefined) {
            director.pos.x = target.x;
            director.pos.y = target.z;
          }
          nextStep();
        }
      }, 5500);

      director.goTo(target, () => {
        if (!reached) {
          reached = true;
          clearTimeout(stepTimer);
          nextStep();
        }
      });
    }

    nextStep();
  }

  function applyFemaleAvatar(worker, session) {
    if (!worker || !worker.P || worker._ftIsBot || worker._ftRobotUpgraded) return;
    const T = window.THREE;
    if (!T) return;
    const sName = (session?.name || worker?.name || '').toLowerCase();
    const isFemale = (session && session.gender === 'female') ||
      worker._ftGender === 'female' ||
      /thị|hà\b|hai ha|khanh ha|phương|mai|linh|lan|hoa|vân|hương|trang|thảo|ngọc|liên|quỳnh|yến|nhung|dung|hằng/i.test(sName);

    const torso = worker.P.spine || worker.P.hip || worker.P.torso;
    const head = worker.P.head;

    if (torso) {
      const oldSkirt = torso.getObjectByName && torso.getObjectByName('ft_female_skirt');
      if (isFemale && !oldSkirt) {
        const skirtGeo = new T.CylinderGeometry(0.18, 0.28, 0.22, 14);
        const skirtMat = new T.MeshStandardMaterial({ color: '#1E293B', roughness: 0.75 });
        const skirt = new T.Mesh(skirtGeo, skirtMat);
        skirt.name = 'ft_female_skirt';
        skirt.position.set(0, -0.18, 0);
        torso.add(skirt);
      } else if (!isFemale && oldSkirt) {
        torso.remove(oldSkirt);
      }
    }
    if (head) {
      const oldHair = head.getObjectByName && head.getObjectByName('ft_female_hair');
      if (isFemale && !oldHair) {
        const hairColor = (session && session.cfg && session.cfg.hair) || '#2B2B2B';
        const hairGeo = new T.BoxGeometry(0.24, 0.26, 0.12);
        const hairMat = new T.MeshStandardMaterial({ color: hairColor, roughness: 0.8 });
        const hair = new T.Mesh(hairGeo, hairMat);
        hair.name = 'ft_female_hair';
        hair.position.set(0, -0.02, -0.14);
        head.add(hair);
      } else if (!isFemale && oldHair) {
        head.remove(oldHair);
      }
    }
  }

  function runPatrolChain(director, waypoints, index) {
    if (!isPatrolling) return;

    if (index >= waypoints.length) {
      // Đã về tới bàn Giám đốc
      isPatrolling = false;
      director.job = null;
      director.station = 'home';
      director.pose = 'sit';
      director.anim = 'type';
      director.say('idle', 'Mọi người làm việc rất nghiêm túc, tốt lắm! 👏');

      setTimeout(triggerWorkersRelief, 1800);
      setTimeout(() => {
        if (!isPatrolling) sendDirectorToCafeVan();
      }, 6000);
      return;
    }

    const wp = waypoints[index];
    director.job = { stage: 'patrol', sess: '__patrol' };
    director.station = 'rounds';
    director.pose = 'stand';
    director.anim = 'walk';

    // Khi Sếp tiến vào phòng mới, tiếp tục quét xem có ai đang giải lao để hối chạy về chỗ
    triggerRushToDesk();

    let finished = false;
    const patrolTimer = setTimeout(() => {
      if (!finished && isPatrolling) {
        console.warn(`[FT Office] Director patrol wp ${index} timeout safeguard, auto proceeding`);
        finished = true;
        if (director.pos && wp.x !== undefined && wp.z !== undefined) {
          director.pos.x = wp.x;
          director.pos.y = wp.z;
        }
        runPatrolChain(director, waypoints, index + 1);
      }
    }, 6500);

    director.goTo(wp, () => {
      if (finished) return;
      finished = true;
      clearTimeout(patrolTimer);
      if (!isPatrolling) return;
      const isLastHome = index === waypoints.length - 1;
      if (isLastHome) {
        runPatrolChain(director, waypoints, index + 1);
        return;
      }

      director.pose = 'stand';
      director.anim = 'idle';
      if (wp.text) {
        director.say('idle', wp.text);
      }
      triggerRushToDesk();

      setTimeout(() => {
        runPatrolChain(director, waypoints, index + 1);
      }, 2500);
    });
  }

  function triggerWorkersRelief() {
    if (!ftOffice.getWorkers) return;
    const workers = Array.from(ftOffice.getWorkers().values());
    const luckyWorkers = workers.filter(w => !w._ftIsBot && !w._ftRobotUpgraded).slice(0, 3);
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

  function handleRosterUpdate(roster) {
    if (!Array.isArray(roster)) return;
    roster.forEach(r => {
      if (r.is_bot || /bot|ai|trợ lý|robot/i.test(r.name || '') || /bot|ai/i.test(r.role || '')) {
        if (r.id !== undefined && r.id !== null) botUserIds.add(String(r.id));
        if (r.user_id !== undefined && r.user_id !== null) botUserIds.add(String(r.user_id));
      }
    });
    if (!ftOffice || !ftOffice.getWorkers || !ftOffice.getSessions) return;
    const workers = ftOffice.getWorkers();
    const sessions = ftOffice.getSessions();

    roster.forEach(r => {
      for (const [id, worker] of workers.entries()) {
        const session = sessions.get(id);
        if (!session) continue;
        const isMatch = (r.name && session.name && session.name.toLowerCase().includes(r.name.toLowerCase())) ||
                        (r.user_id && (session.user_id === r.user_id || id === String(r.user_id)));
        if (isMatch) {
          if (r.is_bot) session.is_bot = true;
          const gender = (r.avatar && r.avatar.gender) || r.gender || session.gender || 'male';
          session.gender = gender;
          worker._ftGender = gender;
          applyFemaleAvatar(worker, session);

          if (r.status === 'home') {
            worker.offstage = true;
            if (worker.root) worker.root.visible = false;
            if (worker.tagObj) worker.tagObj.visible = false;
            continue;
          } else if (r.online !== false) {
            worker.offstage = false;
            if (worker.root) worker.root.visible = true;
            if (worker.tagObj) worker.tagObj.visible = true;
          }

          const isIdle = Boolean(r.is_idle || r.status === 'idle');
          if (isIdle) {
            worker._ftIsIdle = true;
            if (worker.tagEl && !worker.tagEl.querySelector('.ft-idle-badge')) {
              const badge = document.createElement('span');
              badge.className = 'ft-idle-badge';
              badge.style.cssText = 'margin-left:4px;font-size:11px;filter:drop-shadow(0 0 4px #fbbf24);';
              badge.textContent = '💤';
              worker.tagEl.appendChild(badge);
            }
            if (Math.random() < 0.2 && worker.phase !== 'walk' && typeof worker.goTo === 'function') {
              const cf = getCafeVanSpot();
              if (cf) {
                if (cf.door && typeof cf.door.pass === 'function') cf.door.pass();
                worker.goTo({ x: cf.x, z: cf.z, face: cf.face, sit: true }, () => {
                  if (typeof worker.say === 'function') worker.say('idle', '☕ Ra CF Vân hóng gió tí!');
                });
              }
            } else if (Math.random() < 0.25 && typeof worker.say === 'function') {
              worker.say('idle', 'Khò khò... Zzz 💤');
            }
          } else {
            worker._ftIsIdle = false;
            const badge = worker.tagEl && worker.tagEl.querySelector('.ft-idle-badge');
            if (badge) badge.remove();
          }
        }
      }
    });
  }

  /**
   * 5. LẮNG NGHE SỰ KIỆN TỪ HOST
   */
  function setupMessageListeners() {
    if (messageListenersSetup) return;
    messageListenersSetup = true;
    window.addEventListener('message', (ev) => {
      const data = ev.data;
      if (!data || typeof data !== 'object') return;

      switch (data.type) {
        case 'ft-office:roster':
          handleRosterUpdate(data.roster);
          break;
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
            if (typeof window.__ftSwitchView === 'function') {
              window.__ftSwitchView(data.view);
            } else {
              const segBtn = document.querySelector(`.seg-btn[data-view="${data.view}"]`);
              if (segBtn) segBtn.click();
              if (ftOffice && typeof ftOffice.focusRoom === 'function') {
                const PRESETS = {
                  home: [3, 0.3, 9, 1],
                  desks: [3, 0.6, 18.2, 1.6],
                  meeting: [-1.2, 0.6, -5.4, 2.8],
                  server: [-5.6, 1, -0.6, 3.3]
                };
                const p = PRESETS[data.view] || PRESETS.home;
                ftOffice.focusRoom(p[0], p[1], p[2], p[3]);
              }
            }
          }
          break;
        case 'ft-office:focusWorker':
          focusWorkerDesk(data.name, data.userId);
          break;
        case 'ft-office:toggleWalk': {
          const btnFp = document.getElementById('btn-fp');
          if (btnFp) {
            btnFp.click();
            const isFp = document.body.classList.contains('is-fp');
            postToParent({ type: 'ft-office:walkState', active: isFp });
          }
          break;
        }
      }
    });

    // Lắng nghe nút thoát first person nội bộ hoặc phím Escape để đồng bộ trạng thái về parent
    document.addEventListener('click', (e) => {
      const target = e.target;
      if (target && (target.id === 'fp-exit' || (target.closest && target.closest('#fp-exit')))) {
        setTimeout(() => {
          const isFp = document.body.classList.contains('is-fp');
          postToParent({ type: 'ft-office:walkState', active: isFp });
        }, 50);
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('is-fp')) {
        setTimeout(() => {
          const isFp = document.body.classList.contains('is-fp');
          postToParent({ type: 'ft-office:walkState', active: isFp });
        }, 80);
      }
    });
  }

  // Đăng ký listener ngay khi script load để không bỏ sót message sớm
  setupMessageListeners();

  function focusWorkerDesk(workerName, userId) {
    const desksBtn = document.querySelector('.seg-btn[data-view="desks"]');
    if (desksBtn) desksBtn.click();

    if (!ftOffice.getWorkers || !ftOffice.getSessions) return;
    const workers = ftOffice.getWorkers();
    const sessions = ftOffice.getSessions();
    if (!workers || !sessions) return;

    for (const [id, worker] of workers.entries()) {
      const session = sessions.get(id);
      if (!session) continue;
      const match = (workerName && session.name && session.name.toLowerCase().includes(String(workerName).toLowerCase())) ||
                    (userId && (session.user_id === userId || id === String(userId)));
      if (match) {
        if (typeof worker.say === 'function') {
          worker.say('idle', '👋 Tôi đây rồi!');
        }
        if (typeof window.setHoverPerson === 'function') {
          try {
            window.setHoverPerson(session);
          } catch (e) {
            // Ignore
          }
        }
        break;
      }
    }
  }

  // Khởi động
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
