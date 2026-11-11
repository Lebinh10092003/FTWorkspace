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

  console.log('[FT Office] Enhancements v2.9 initializing...');

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

  function isBotSession(id, session) {
    if (!session) return false;
    const strId = id !== undefined && id !== null ? String(id) : '';
    const sessionId = session.id !== undefined && session.id !== null ? String(session.id) : '';
    const sessionUserId = session.user_id !== undefined && session.user_id !== null ? String(session.user_id) : '';
    return Boolean(
      session.is_bot ||
      session.isBot ||
      botUserIds.has(strId) ||
      (sessionId && botUserIds.has(sessionId)) ||
      (sessionUserId && botUserIds.has(sessionUserId)) ||
      /bot|ai|trợ lý|robot/i.test(session.name || '') ||
      /bot|ai/i.test(session.role || '') ||
      strId.startsWith('bot-') ||
      strId.startsWith('ft-bot')
    );
  }

  function init() {
    office = window.__office || {};
    ftOffice = window.__ftOffice || {};
    THREE = office.THREE || ftOffice.THREE || window.THREE;

    if (!THREE || !ftOffice.getWorkers) {
      setTimeout(init, 300);
      return;
    }

    console.log('[FT Office] Dependencies ready. Hooking enhancements.');

    // 1. Quét biến đổi Bot thành Robot Mech 3D
    setInterval(upgradeAllBotsToRobotMesh, 1500);

    // 2. Chạy vòng lặp thoại ngẫu nhiên chất FermatTech
    setInterval(tickFermatIdleQuotes, 8000);

    // 3. Vòng lặp nhấp nháy mắt & đèn ăng-ten Robot
    setInterval(animateRobotEyes, 400);

    // 4. Tuần tra Giám đốc định kỳ (mỗi 75 - 120s ngẫu nhiên)
    scheduleNextDirectorPatrol();

    // 5. Đảm bảo lắng nghe lệnh điều khiển từ Host (đã gọi sớm khi load script)
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
   * 1. BIẾN ĐỔI TOÀN BỘ BOT AI THÀNH ROBOT MECH 3D
   */
  function upgradeAllBotsToRobotMesh() {
    if (!ftOffice || !ftOffice.getWorkers || !ftOffice.getSessions) return;
    const workers = ftOffice.getWorkers();
    const sessions = ftOffice.getSessions();

    for (const [id, worker] of workers.entries()) {
      const session = sessions.get(id);
      if (!session) continue;

      const isBot = isBotSession(id, session);

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
            }
          });
        });
      }

      if (isBot && !worker._ftRobotUpgraded && worker.P && worker.P.head) {
        transformWorkerToRobot(worker, session);
      }
    }
  }

  function transformWorkerToRobot(worker, session) {
    try {
      if (worker._ftRobotUpgraded) return;
      worker._ftRobotUpgraded = true;

      // Duyệt qua các bộ phận người cũ để ẩn toàn bộ mesh (giữ nguyên Group pivot cho animation)
      const humanPartGroups = [
        worker.P?.head,
        worker.P?.torso,
        worker.P?.armL?.sh,
        worker.P?.armL?.el,
        worker.P?.armR?.sh,
        worker.P?.armR?.el,
        worker.P?.legL?.hip,
        worker.P?.legL?.knee,
        worker.P?.legR?.hip,
        worker.P?.legR?.knee
      ];

      humanPartGroups.forEach(grp => {
        if (!grp) return;
        grp.traverse(child => {
          if (child.isMesh) {
            child.visible = false;
          }
        });
      });

      // Vật liệu kim loại cao cấp
      const titaniumMat = new THREE.MeshStandardMaterial({
        color: '#1E293B',
        metalness: 0.88,
        roughness: 0.22
      });
      const slateArmorMat = new THREE.MeshStandardMaterial({
        color: '#334155',
        metalness: 0.82,
        roughness: 0.28
      });
      const accentMat = new THREE.MeshStandardMaterial({
        color: '#0EA5E9',
        metalness: 0.7,
        roughness: 0.3
      });
      const neonVisorMat = new THREE.MeshStandardMaterial({
        color: '#00F0FF',
        emissive: '#00F0FF',
        emissiveIntensity: 2.2,
        roughness: 0.1
      });
      const reactorMat = new THREE.MeshStandardMaterial({
        color: '#38BDF8',
        emissive: '#00F0FF',
        emissiveIntensity: 2.5,
        roughness: 0.1
      });

      // 1. Gắn vào worker.P.head: Mũ giáp Mech góc cạnh, 2 tai cảm biến trụ tròn, Visor LED neon, 2 ăng-ten kèm beacon
      if (worker.P?.head) {
        const headGroup = new THREE.Group();
        headGroup.name = 'ft_robot_head_mech';

        // Mũ giáp Mech góc cạnh (BoxGeometry 0.28x0.26x0.28)
        const helmetGeo = new THREE.BoxGeometry(0.28, 0.26, 0.28);
        const helmetMesh = new THREE.Mesh(helmetGeo, slateArmorMat);
        helmetMesh.position.set(0, 0.02, 0);
        helmetMesh.castShadow = true;
        headGroup.add(helmetMesh);

        // 2 tai cảm biến trụ tròn 2 bên
        const earGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.04, 16);
        earGeo.rotateZ(Math.PI / 2);
        const leftEar = new THREE.Mesh(earGeo, titaniumMat);
        leftEar.position.set(-0.15, 0.02, 0);
        const rightEar = new THREE.Mesh(earGeo, titaniumMat);
        rightEar.position.set(0.15, 0.02, 0);
        headGroup.add(leftEar, rightEar);

        // Visor mắt LED neon phát sáng cyan phía trước mặt (0, 0.02, 0.145)
        const visorGeo = new THREE.BoxGeometry(0.20, 0.06, 0.02);
        const visorMesh = new THREE.Mesh(visorGeo, neonVisorMat);
        visorMesh.position.set(0, 0.02, 0.145);
        headGroup.add(visorMesh);

        // 2 ăng-ten đỉnh đầu kèm đèn beacon nhấp nháy
        const antPoleGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.10, 8);
        const leftPole = new THREE.Mesh(antPoleGeo, titaniumMat);
        leftPole.position.set(-0.08, 0.18, 0);
        const rightPole = new THREE.Mesh(antPoleGeo, titaniumMat);
        rightPole.position.set(0.08, 0.18, 0);
        headGroup.add(leftPole, rightPole);

        const beaconGeo = new THREE.SphereGeometry(0.02, 12, 10);
        const beaconMat = new THREE.MeshStandardMaterial({
          color: '#F59E0B',
          emissive: '#F59E0B',
          emissiveIntensity: 2.0,
          roughness: 0.1
        });
        const leftBeacon = new THREE.Mesh(beaconGeo, beaconMat);
        leftBeacon.position.set(-0.08, 0.23, 0);
        const rightBeacon = new THREE.Mesh(beaconGeo, beaconMat);
        rightBeacon.position.set(0.08, 0.23, 0);
        headGroup.add(leftBeacon, rightBeacon);

        worker.P.head.add(headGroup);
        worker._ftBeaconMat = beaconMat;
        worker._ftVisorMat = neonVisorMat;
      }

      // 2. Gắn vào worker.P.torso: Khối giáp ngực Mech, 2 giáp vai Pauldrons, Lõi Arc Reactor, Jetpack sau lưng
      if (worker.P?.torso) {
        const torsoGroup = new THREE.Group();
        torsoGroup.name = 'ft_robot_torso_mech';

        // Khối giáp ngực Mech (0.36x0.42x0.26)
        const chestGeo = new THREE.BoxGeometry(0.36, 0.42, 0.26);
        const chestMesh = new THREE.Mesh(chestGeo, titaniumMat);
        chestMesh.position.set(0, 0, 0);
        chestMesh.castShadow = true;
        torsoGroup.add(chestMesh);

        // 2 giáp vai Pauldrons nhô lên 2 bên
        const pauldronGeo = new THREE.BoxGeometry(0.12, 0.10, 0.28);
        const leftPauldron = new THREE.Mesh(pauldronGeo, slateArmorMat);
        leftPauldron.position.set(-0.21, 0.18, 0);
        leftPauldron.rotation.z = -0.15;
        leftPauldron.castShadow = true;
        const rightPauldron = new THREE.Mesh(pauldronGeo, slateArmorMat);
        rightPauldron.position.set(0.21, 0.18, 0);
        rightPauldron.rotation.z = 0.15;
        rightPauldron.castShadow = true;
        torsoGroup.add(leftPauldron, rightPauldron);

        // Lõi Arc Reactor tròn ở chính giữa ngực (TorusGeometry + CylinderGeometry phát sáng cyan ở z=0.14)
        const reactorGroup = new THREE.Group();
        reactorGroup.position.set(0, 0.04, 0.14);

        const ringGeo = new THREE.TorusGeometry(0.05, 0.012, 16, 24);
        const ringMesh = new THREE.Mesh(ringGeo, accentMat);

        const coreGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.015, 24);
        coreGeo.rotateX(Math.PI / 2);
        const coreMesh = new THREE.Mesh(coreGeo, reactorMat);
        reactorGroup.add(ringMesh, coreMesh);
        torsoGroup.add(reactorGroup);

        // Khối Jetpack năng lượng sau lưng (0, 0.02, -0.17) kèm 2 ống xả phát sáng xanh
        const jetpackGroup = new THREE.Group();
        jetpackGroup.position.set(0, 0.02, -0.17);

        const packGeo = new THREE.BoxGeometry(0.24, 0.30, 0.10);
        const packMesh = new THREE.Mesh(packGeo, slateArmorMat);
        packMesh.castShadow = true;
        jetpackGroup.add(packMesh);

        const nozzleGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.09, 16);
        const leftNozzle = new THREE.Mesh(nozzleGeo, titaniumMat);
        leftNozzle.position.set(-0.07, -0.12, 0);
        const rightNozzle = new THREE.Mesh(nozzleGeo, titaniumMat);
        rightNozzle.position.set(0.07, -0.12, 0);

        const exhaustGeo = new THREE.CylinderGeometry(0.025, 0.01, 0.04, 16);
        const leftExhaust = new THREE.Mesh(exhaustGeo, reactorMat);
        leftExhaust.position.set(-0.07, -0.17, 0);
        const rightExhaust = new THREE.Mesh(exhaustGeo, reactorMat);
        rightExhaust.position.set(0.07, -0.17, 0);

        jetpackGroup.add(leftNozzle, rightNozzle, leftExhaust, rightExhaust);
        torsoGroup.add(jetpackGroup);

        worker.P.torso.add(torsoGroup);
        worker._ftReactorMat = reactorMat;
      }

      // 3. Gắn vào worker.P.armL.sh / el và worker.P.armR.sh / el: Ống giáp cánh tay cơ khí và càng kẹp bàn tay robot
      function buildUpperArmArmor() {
        const grp = new THREE.Group();
        const armorGeo = new THREE.BoxGeometry(0.11, 0.18, 0.11);
        const armorMesh = new THREE.Mesh(armorGeo, titaniumMat);
        armorMesh.position.set(0, -0.09, 0);
        armorMesh.castShadow = true;

        const trimGeo = new THREE.BoxGeometry(0.12, 0.04, 0.12);
        const trimMesh = new THREE.Mesh(trimGeo, accentMat);
        trimMesh.position.set(0, -0.04, 0);

        grp.add(armorMesh, trimMesh);
        return grp;
      }

      function buildForearmAndClaw() {
        const grp = new THREE.Group();
        const armGeo = new THREE.BoxGeometry(0.10, 0.16, 0.10);
        const armMesh = new THREE.Mesh(armGeo, slateArmorMat);
        armMesh.position.set(0, -0.08, 0);
        armMesh.castShadow = true;

        const wristGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.03, 12);
        const wristMesh = new THREE.Mesh(wristGeo, titaniumMat);
        wristMesh.position.set(0, -0.17, 0);

        // Càng kẹp bàn tay robot
        const clawGeo = new THREE.BoxGeometry(0.02, 0.06, 0.03);
        const leftClaw = new THREE.Mesh(clawGeo, accentMat);
        leftClaw.position.set(-0.025, -0.21, 0);
        const rightClaw = new THREE.Mesh(clawGeo, accentMat);
        rightClaw.position.set(0.025, -0.21, 0);

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
        const shinGeo = new THREE.BoxGeometry(0.12, 0.22, 0.13);
        const shinMesh = new THREE.Mesh(shinGeo, slateArmorMat);
        shinMesh.position.set(0, -0.11, 0);
        shinMesh.castShadow = true;

        const footGeo = new THREE.BoxGeometry(0.12, 0.06, 0.18);
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

      // 5. Gắn vào worker.P.root (nếu có) hoặc worker.root: Đĩa đệm phản lực Hover Repulsor Ring
      const rootTarget = (worker.P && worker.P.root) ? worker.P.root : worker.root;
      if (rootTarget) {
        const repulsorGroup = new THREE.Group();
        repulsorGroup.name = 'ft_robot_repulsor';

        const repulsorMat = new THREE.MeshBasicMaterial({
          color: '#00F0FF',
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
          color: '#00F0FF',
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.set(0, 0.04, 0);

        repulsorGroup.add(torusMesh, ringMesh);
        rootTarget.add(repulsorGroup);

        worker._ftRepulsorMat = repulsorMat;
        worker._ftRepulsorDiscMat = ringMat;
      }

      // Cập nhật tag hiển thị trên đầu
      if (worker.tagDot) {
        worker.tagDot.style.background = '#00F0FF';
        worker.tagDot.style.boxShadow = '0 0 10px #00F0FF';
      }
      if (worker.tagEl) {
        worker.tagEl.title = `[Robot AI Mech] ${session.name}`;
      }

      console.log(`[FT Office] Transformed bot ${session.name} (${session.id}) to 3D Mech Robot!`);
    } catch (err) {
      console.warn('[FT Office] Failed to transform bot:', err);
    }
  }

  function animateRobotEyes() {
    const t = Date.now() / 300;
    const pulse = (Math.sin(t) + 1) / 2;

    const shouldBlink = Math.random() < 0.15;
    robotEyeMaterials.forEach(mat => {
      if (shouldBlink) {
        mat.color.set('#0F172A'); // Nhắm mắt
        setTimeout(() => mat.color.set('#06B6D4'), 120);
      }
    });

    // Nhấp nháy đèn ăng-ten, visor, lõi reactor và Hover Repulsor Ring
    if (ftOffice && ftOffice.getWorkers) {
      const workers = ftOffice.getWorkers();
      workers.forEach(w => {
        if (w._ftBeaconMat) {
          const bright = pulse > 0.4;
          const color = bright ? (w._ftServing ? '#10B981' : '#F59E0B') : '#78350F';
          w._ftBeaconMat.color.set(color);
          w._ftBeaconMat.emissive.set(color);
        }
        if (w._ftAntBulbMat) {
          const bright = pulse > 0.4;
          w._ftAntBulbMat.color.set(bright ? (w._ftServing ? '#10B981' : '#F59E0B') : '#78350F');
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
          w._ftVisorMat.emissiveIntensity = 0.2;
          setTimeout(() => {
            if (w._ftVisorMat) w._ftVisorMat.emissiveIntensity = 2.2;
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

    for (const [id, worker] of workers.entries()) {
      const session = sessions.get(id);
      if (!session) continue;
      const isBot = isBotSession(id, session);

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
            if (Math.random() < 0.25 && typeof worker.say === 'function') {
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
