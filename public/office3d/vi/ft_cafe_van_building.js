/* global window, document */
/**
 * Quán CF Vân — toà nhà 3 tầng dựng bằng hình khối Three.js.
 *
 * Module nhận THREE từ ngoài (window.THREE) thay vì tự import.
 * Mọi toạ độ suy ra từ object LOT, không rải số khắp thân hàm.
 */
(function () {
  'use strict';

  var LOT = {
    frontX: -15.46,     // mặt phẳng mặt tiền
    backX: -19.60,      // tường hậu (sâu 4.14 m vào trong lô)
    zMin: 6.30, zMax: 11.10,   // bề ngang 4.80 m
    groundY: 0,
    hGround: 2.95,      // tầng trệt
    hFascia: 0.75,      // dải biển 2.95 -> 3.70
    hFloor2: 2.85,      // 3.70 -> 6.55
    hFloor3: 2.50,      // 6.55 -> 9.05
    hParapet: 0.35      // 9.05 -> 9.40
  };

  function signTexture(THREE) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    var canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#2f2018';
    ctx.fillRect(0, 0, 1024, 256);

    // Đường kẻ kem mảnh trên / dưới
    ctx.strokeStyle = '#f3e3c3';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(80, 28);
    ctx.lineTo(944, 28);
    ctx.moveTo(80, 224);
    ctx.lineTo(944, 224);
    ctx.stroke();

    ctx.fillStyle = '#f3e3c3';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 150px Georgia, "Times New Roman", serif';
    ctx.fillText('CF VÂN', 512, 168);
    ctx.font = '44px Georgia, "Times New Roman", serif';
    ctx.fillText('CÀ PHÊ · BÁNH NGỌT', 512, 214);

    var tex = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function menuTexture(THREE) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    var canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 320;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#1b1b1b';
    ctx.fillRect(0, 0, 512, 320);
    ctx.strokeStyle = '#d9c9a6';
    ctx.lineWidth = 6;
    ctx.strokeRect(16, 16, 480, 288);

    ctx.fillStyle = '#f3e3c3';
    ctx.textAlign = 'center';
    ctx.font = 'bold 72px Georgia, "Times New Roman", serif';
    ctx.fillText('MENU', 256, 106);
    ctx.font = '30px Georgia, "Times New Roman", serif';
    ctx.fillText('CÀ PHÊ  ·  TRÀ  ·  BÁNH', 256, 178);
    ctx.fillText('SÁNG  ·  TRƯA  ·  CHIỀU', 256, 228);

    var tex = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function build(THREE, opts) {
    if (!THREE) {
      throw new Error('FTCafeVan.build requires THREE');
    }
    opts = opts || {};

    // ---- Số đo suy ra từ LOT ----
    var W = LOT.zMax - LOT.zMin;                 // 4.80 — bề ngang
    var D = LOT.frontX - LOT.backX;              // 4.14 — chiều sâu
    var midZ = (LOT.zMin + LOT.zMax) / 2;        // 8.70
    var midX = (LOT.frontX + LOT.backX) / 2;     // -17.53

    var y1 = LOT.groundY + LOT.hGround;          // 2.95
    var y2 = y1 + LOT.hFascia;                   // 3.70
    var y3 = y2 + LOT.hFloor2;                   // 6.55
    var y4 = y3 + LOT.hFloor3;                   // 9.05
    var yTop = y4 + LOT.hParapet;                // 9.40

    var rearT = 0.20;                            // tường hậu
    var sideT = 0.18;                            // tường bên
    var frontT = 0.14;                           // tường trước
    var pillarW = 0.30;                          // trụ góc nhô ra theo x
    var pillarD = 0.45;                          // bề rộng trụ theo z

    var glassX = LOT.frontX - 0.14;              // kính lùi vào 0.14
    var doorX = LOT.frontX - 0.49;               // cửa lùi sâu
    // ---- Cache hình học / vật liệu ----
    var geoCache = {};
    var matCache = {};

    function num(n) { return n.toFixed(4); }

    function boxGeo(w, h, d) {
      var key = 'b' + num(w) + '_' + num(h) + '_' + num(d);
      if (!geoCache[key]) geoCache[key] = new THREE.BoxGeometry(w, h, d);
      return geoCache[key];
    }

    function planeGeo(w, h) {
      var key = 'p' + num(w) + '_' + num(h);
      if (!geoCache[key]) geoCache[key] = new THREE.PlaneGeometry(w, h);
      return geoCache[key];
    }

    function cylGeo(rTop, rBot, h, seg) {
      var key = 'c' + num(rTop) + '_' + num(rBot) + '_' + num(h) + '_' + seg;
      if (!geoCache[key]) geoCache[key] = new THREE.CylinderGeometry(rTop, rBot, h, seg);
      return geoCache[key];
    }

    function coneGeo(r, h, seg, open) {
      var key = 'k' + num(r) + '_' + num(h) + '_' + seg + '_' + (open ? 1 : 0);
      if (!geoCache[key]) geoCache[key] = new THREE.ConeGeometry(r, h, seg, 1, !!open);
      return geoCache[key];
    }

    function sphereGeo(r, wSeg, hSeg) {
      var key = 's' + num(r) + '_' + wSeg + '_' + hSeg;
      if (!geoCache[key]) geoCache[key] = new THREE.SphereGeometry(r, wSeg, hSeg);
      return geoCache[key];
    }

    function mat(color, o) {
      o = o || {};
      var key = [
        color, o.roughness, o.metalness, o.transparent ? o.opacity : '',
        o.emissive, o.emissiveIntensity, o.side, o.wireframe
      ].join('|');
      if (matCache[key]) return matCache[key];
      var params = { color: color };
      if (o.roughness !== undefined) params.roughness = o.roughness;
      if (o.metalness !== undefined) params.metalness = o.metalness;
      if (o.transparent) { params.transparent = true; params.opacity = o.opacity; }
      if (o.emissive !== undefined) params.emissive = o.emissive;
      if (o.emissiveIntensity !== undefined) params.emissiveIntensity = o.emissiveIntensity;
      if (o.side !== undefined) params.side = o.side;
      if (o.depthWrite !== undefined) params.depthWrite = o.depthWrite;
      var m = new THREE.MeshStandardMaterial(params);
      matCache[key] = m;
      return m;
    }

    function addBox(parent, w, h, d, material, x, y, z) {
      var obj = new THREE.Mesh(boxGeo(w, h, d), material);
      obj.position.set(x, y, z);
      parent.add(obj);
      return obj;
    }

    function addPlane(parent, w, h, material, x, y, z) {
      var obj = new THREE.Mesh(planeGeo(w, h), material);
      obj.position.set(x, y, z);
      obj.rotation.y = Math.PI / 2; // normal hướng +x (ra đường)
      parent.add(obj);
      return obj;
    }

    function addCyl(parent, rTop, rBot, h, seg, material, x, y, z) {
      var obj = new THREE.Mesh(cylGeo(rTop, rBot, h, seg), material);
      obj.position.set(x, y, z);
      parent.add(obj);
      return obj;
    }

    // ---- Vật liệu chính ----
    var stucco = mat(0xe6ddca, { roughness: 0.92, metalness: 0.02 });
    var alu = mat(0x2b3440, { roughness: 0.36, metalness: 0.72 });
    var aluLight = mat(0x8a8f96, { roughness: 0.4, metalness: 0.8 });
    var woodDark = mat(0x4a3527, { roughness: 0.78, metalness: 0.04 });
    var woodLeaf = mat(0x5a4030, { roughness: 0.7, metalness: 0.04 });
    var woodCounter = mat(0x6b4a2f, { roughness: 0.66, metalness: 0.04 });
    var stone = mat(0xefe6d6, { roughness: 0.5, metalness: 0.05 });
    var metalBlack = mat(0x1f2328, { roughness: 0.45, metalness: 0.65 });
    var grass = mat(0x3f6b3a, { roughness: 0.95, metalness: 0 });
    var terracotta = mat(0x8a5a3d, { roughness: 0.9, metalness: 0.02 });
    var tileMat = mat(0xcdbfa8, { roughness: 0.95, metalness: 0.02 });
    var awningMat = mat(0x24483a, { roughness: 0.85, metalness: 0.02 });
    var fasciaMat = mat(0x3a2b21, { roughness: 0.8, metalness: 0.04 });
    var stainless = mat(0xb8bdc0, { roughness: 0.3, metalness: 0.78 });
    var pipeMat = mat(0xcfc7b6, { roughness: 0.75, metalness: 0.1 });
    var brass = mat(0xc9a227, { roughness: 0.42, metalness: 0.55 });
    var bulbMat = mat(0xffd9a0, { roughness: 0.3, metalness: 0, emissive: 0xffca7a, emissiveIntensity: 1.0 });
    var blackBoard = mat(0x1b1b1b, { roughness: 0.9, metalness: 0.02 });

    var glassMat = mat(0x3d5f6b, {
      roughness: 0.06, metalness: 0.35, transparent: true, opacity: 0.42,
      side: THREE.DoubleSide, depthWrite: false
    });
    var winGlassMat = mat(0x1d2b36, { roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.72 });
    var winLitMat = mat(0x1d2b36, {
      roughness: 0.12, metalness: 0.35, emissive: 0xffb26b, emissiveIntensity: 0.35
    });
    // Mặt trong cửa sổ: phòng sáng (rèm ấm) hoặc tối — tạo chiều sâu thật
    var winGlowMat = mat(0xf0b478, {
      roughness: 0.9, metalness: 0, emissive: 0xffa653, emissiveIntensity: 0.55
    });
    var winDarkMat = mat(0x0e151b, { roughness: 0.95, metalness: 0 });
    var menuBlack = mat(0x24211d, { roughness: 0.85, metalness: 0.04 });

    var group = new THREE.Group();
    group.name = 'ft_cafe_van_building';
    group.userData = { version: 'v7_rebuild' };

    // ============================================================
    // 1. KHUNG NHÀ — 4 mặt tường + sàn các tầng
    // ============================================================
    var shell = new THREE.Group();
    shell.name = 'ft_cafe_van_shell';
    group.add(shell);

    // Tường hậu
    addBox(shell, rearT, y4, W, stucco, LOT.backX + rearT / 2, y4 / 2, midZ);

    // Hai tường bên
    var sideDepth = D - rearT;
    var sideCenterX = LOT.backX + rearT + sideDepth / 2;
    addBox(shell, sideDepth, y4, sideT, stucco, sideCenterX, y4 / 2, LOT.zMin + sideT / 2);
    addBox(shell, sideDepth, y4, sideT, stucco, sideCenterX, y4 / 2, LOT.zMax - sideT / 2);

    // Hai trụ góc mặt tiền
    addBox(shell, pillarW, y4, pillarD, stucco, LOT.frontX - pillarW / 2, y4 / 2, LOT.zMin + pillarD / 2);
    addBox(shell, pillarW, y4, pillarD, stucco, LOT.frontX - pillarW / 2, y4 / 2, LOT.zMax - pillarD / 2);

    // Tường mặt tiền tầng 2–3 (phần đặc, có cửa sổ khoét giả bằng khung)
    var upperH = y4 - (y1 - 0.10);
    addBox(shell, frontT, upperH, W, stucco, LOT.frontX - frontT / 2, (y1 - 0.10 + y4) / 2, midZ);

    // Sàn tầng 1, tầng 2 và sàn mái
    addBox(shell, D, 0.20, W, stucco, midX, y1, midZ);
    addBox(shell, D, 0.18, W, stucco, midX, y3, midZ);
    addBox(shell, D, 0.18, W, stucco, midX, y4 - 0.09, midZ);

    // Lan can mái (parapet) + gờ đậy
    addBox(shell, 0.16, LOT.hParapet, W, stucco, LOT.frontX - 0.08, y4 + LOT.hParapet / 2, midZ);
    addBox(shell, 0.16, LOT.hParapet, W, stucco, LOT.backX + 0.08, y4 + LOT.hParapet / 2, midZ);
    addBox(shell, D, LOT.hParapet, 0.16, stucco, midX, y4 + LOT.hParapet / 2, LOT.zMin + 0.08);
    addBox(shell, D, LOT.hParapet, 0.16, stucco, midX, y4 + LOT.hParapet / 2, LOT.zMax - 0.08);
    addBox(shell, 0.24, 0.08, W + 0.16, stucco, LOT.frontX - 0.08, yTop + 0.04, midZ);
    addBox(shell, 0.24, 0.08, W + 0.16, stucco, LOT.backX + 0.08, yTop + 0.04, midZ);

    // ============================================================
    // 2. TẦNG TRỆT — MẶT TIỀN KÍNH + CỬA LÙI
    // ============================================================
    var glazing = new THREE.Group();
    glazing.name = 'ft_cafe_van_glazing';
    group.add(glazing);

    var glassBottom = LOT.groundY + 0.10;
    var glassTop = y1 - 0.10;
    var glassH = glassTop - glassBottom;
    var glassZMin = LOT.zMin + pillarD;
    var glassZMax = LOT.zMax - pillarD;
    var glassW = glassZMax - glassZMin;
    var glassCenterZ = (glassZMin + glassZMax) / 2;

    addPlane(glazing, glassW, glassH, glassMat, glassX, (glassBottom + glassTop) / 2, glassCenterZ);

    // Thanh nhôm chia ô kính (2 dọc + 1 ngang)
    var mullionGeoW = 0.06;
    var mullionY = (glassBottom + glassTop) / 2;
    var mullW = 0.09;
    addBox(glazing, mullW, glassH, mullW, aluLight, glassX + 0.03, mullionY, glassZMin + glassW / 3);
    addBox(glazing, mullW, glassH, mullW, aluLight, glassX + 0.03, mullionY, glassZMin + glassW * 2 / 3);
    addBox(glazing, mullW, mullW, glassW, aluLight, glassX + 0.03, 2.35, glassCenterZ);
    // Ray ngang dưới + trên khung kính cho rõ vật liệu
    addBox(glazing, 0.12, 0.12, glassW, aluLight, glassX + 0.03, glassBottom + 0.06, glassCenterZ);
    addBox(glazing, 0.12, 0.10, glassW, aluLight, glassX + 0.03, glassTop - 0.05, glassCenterZ);

    // Cửa vào lùi sâu, khung gỗ + tay nắm
    var doorZCenter = glassZMax - 0.15 - 0.475;   // 9.55 -> 10.50
    var doorH = 2.55;
    var doorBottom = glassBottom;
    addBox(glazing, 0.05, doorH + 0.10, 1.10, woodDark, doorX - 0.03, doorBottom + doorH / 2, doorZCenter);
    addBox(glazing, 0.06, doorH, 0.95, woodLeaf, doorX, doorBottom + doorH / 2, doorZCenter);
    addBox(glazing, 0.04, 0.03, 0.16, aluLight, doorX + 0.05, doorBottom + 1.05, doorZCenter - 0.32);

    // ============================================================
    // 3. BÊN TRONG NHÌN THẤY QUA KÍNH
    // ============================================================
    var inside = new THREE.Group();
    inside.name = 'ft_cafe_van_interior';
    group.add(inside);

    // Quầy bar: thân gỗ + mặt đá
    var barX = LOT.backX + 1.40;
    addBox(inside, 0.62, 0.95, 1.80, woodCounter, barX, 0.475, midZ);
    addBox(inside, 0.72, 0.06, 1.92, stone, barX, 0.98, midZ);

    // Bảng đen MENU trên tường hậu
    var menuTex = menuTexture(THREE);
    var menuMat = new THREE.MeshStandardMaterial({
      color: menuTex ? 0xffffff : 0x24211d,
      roughness: 0.85,
      metalness: 0.04
    });
    if (menuTex) menuMat.map = menuTex;
    addPlane(inside, 1.30, 0.80, menuMat, LOT.backX + rearT + 0.02, 1.72, midZ);

    // 2 bàn tròn nhỏ + 4 ghế
    var tableCX = -16.55;
    var tableZs = [7.55, 9.80];
    var i;
    for (i = 0; i < tableZs.length; i++) {
      var tz = tableZs[i];
      addCyl(inside, 0.30, 0.30, 0.05, 18, woodCounter, tableCX, 0.72, tz);
      addCyl(inside, 0.04, 0.04, 0.70, 10, metalBlack, tableCX, 0.35, tz);

      var chairOffsets = [-0.48, 0.48];
      var c;
      for (c = 0; c < chairOffsets.length; c++) {
        var cz = tz + chairOffsets[c];
        addBox(inside, 0.40, 0.05, 0.40, woodCounter, tableCX, 0.44, cz);
        var backZ = cz + (chairOffsets[c] < 0 ? -0.175 : 0.175);
        addBox(inside, 0.40, 0.40, 0.05, woodCounter, tableCX, 0.64, backZ);
      }
    }

    // 3 đèn thả trần: chao nón vàng + bóng phát sáng
    var lampZs = [7.55, midZ, 9.80];
    for (i = 0; i < lampZs.length; i++) {
      var shade = new THREE.Mesh(coneGeo(0.18, 0.30, 12, true), brass);
      shade.position.set(-16.90, 2.70, lampZs[i]);
      inside.add(shade);
      var bulb = new THREE.Mesh(sphereGeo(0.05, 8, 6), bulbMat);
      bulb.position.set(-16.90, 2.50, lampZs[i]);
      inside.add(bulb);
      // dây treo đèn lên trần
      addCyl(inside, 0.008, 0.008, 0.14, 5, metalBlack, -16.90, 2.78, lampZs[i]);
    }

    // 2 chậu cây trong quán
    var plantZs = [glassZMin + 0.23, glassZMax - 0.23];
    for (i = 0; i < plantZs.length; i++) {
      addCyl(inside, 0.14, 0.12, 0.30, 10, terracotta, -15.85, 0.15, plantZs[i]);
      var foliage = new THREE.Mesh(sphereGeo(0.22, 8, 6), grass);
      foliage.position.set(-15.85, 0.45, plantZs[i]);
      inside.add(foliage);
    }

    // Ánh sáng ấm duy nhất hắt ra vỉa hè
    var light = new THREE.PointLight(0xffb46b, 6, 6.5, 2);
    light.position.set(-17.0, 2.3, midZ);
    group.add(light);

    // ============================================================
    // 4. DẢI FASCIA + BIỂN HIỆU
    // ============================================================
    var fascia = new THREE.Group();
    fascia.name = 'ft_cafe_van_fascia';
    group.add(fascia);

    var fasciaCenterX = LOT.frontX + 0.05;        // mặt trước -15.34
    addBox(fascia, 0.14, LOT.hFascia, W, fasciaMat, fasciaCenterX, y1 + LOT.hFascia / 2, midZ);

    // Gờ nhôm hai đầu dải biển
    addBox(fascia, 0.03, LOT.hFascia + 0.04, 0.04, aluLight, LOT.frontX + 0.065, y1 + LOT.hFascia / 2, LOT.zMin + 0.02);
    addBox(fascia, 0.03, LOT.hFascia + 0.04, 0.04, aluLight, LOT.frontX + 0.065, y1 + LOT.hFascia / 2, LOT.zMax - 0.02);

    // Biển hiệu canvas "CF VÂN"
    var signTex = signTexture(THREE);
    var signMat = new THREE.MeshStandardMaterial({
      color: signTex ? 0xffffff : 0x2f2018,
      roughness: 0.55,
      metalness: 0.08,
      emissive: 0x6a4a2a,
      emissiveIntensity: 0.35
    });
    if (signTex) {
      signMat.map = signTex;
      signMat.emissiveMap = signTex;
    }
    addPlane(fascia, 3.55, 0.62, signMat, LOT.frontX + 0.125, 3.32, midZ);

    // ============================================================
    // 5. MÁI HIÊN (AWNING), KHÔNG CỘT CHỐNG
    // ============================================================
    var awning = new THREE.Group();
    awning.name = 'ft_cafe_van_awning';
    group.add(awning);

    var awnX0 = LOT.frontX;
    var awnY0 = 2.97;   // gối 2 cm vào dải fascia để không hở khe sáng
    var awnX1 = LOT.frontX + 1.01;                // -14.45
    var awnY1 = 2.72;
    var awnRun = awnX1 - awnX0;
    var awnDrop = awnY0 - awnY1;
    var awnLen = Math.sqrt(awnRun * awnRun + awnDrop * awnDrop);
    var awnAngle = Math.atan2(awnDrop, awnRun);
    var awnZMin = LOT.zMin + 0.40;
    var awnZMax = LOT.zMax - 0.20;
    var awnZCenter = (awnZMin + awnZMax) / 2;

    var awn = addBox(awning, awnLen, 0.06, awnZMax - awnZMin, awningMat,
      (awnX0 + awnX1) / 2, (awnY0 + awnY1) / 2, awnZCenter);
    awn.rotation.z = -awnAngle;

    // Diềm buông mép ngoài
    addBox(awning, 0.03, 0.18, awnZMax - awnZMin, awningMat, awnX1, awnY1 - 0.09, awnZCenter);

    // ============================================================
    // 6. CỬA SỔ TẦNG 2 & 3
    // ============================================================
    var windows = new THREE.Group();
    windows.name = 'ft_cafe_van_windows';
    group.add(windows);

    var winW = 1.02;
    var winH = 1.45;
    var winGlassW = 0.90;
    var winGlassH = 1.33;
    var winZ = [7.35, midZ, 10.05];
    var winRows = [
      { bottom: 4.10, lit: 1 },   // tầng 2, cửa giữa sáng
      { bottom: 6.95, lit: 0 }    // tầng 3, cửa trái sáng
    ];
    var r, cidx;
    for (r = 0; r < winRows.length; r++) {
      var row = winRows[r];
      var winCenterY = row.bottom + winH / 2;
      for (cidx = 0; cidx < winZ.length; cidx++) {
        var zc = winZ[cidx];
        // Khung nhôm 4 thanh (không đặc), mặt ngoài nhô 7 cm; kính lùi 4 cm vào trong khung
        var fD = 0.10;                                        // dày khung theo phương x
        var fB = 0.055;                                       // bề rộng thanh khung
        var fX = LOT.frontX + 0.02;
        addBox(windows, fD, fB, winW, aluLight, fX, winCenterY + winH / 2 - fB / 2, zc);
        addBox(windows, fD, fB, winW, aluLight, fX, winCenterY - winH / 2 + fB / 2, zc);
        addBox(windows, fD, winH - fB * 2, fB, aluLight, fX, winCenterY, zc - winW / 2 + fB / 2);
        addBox(windows, fD, winH - fB * 2, fB, aluLight, fX, winCenterY, zc + winW / 2 - fB / 2);
        var lit = (r === 0 && cidx === 1) || (r === 1 && cidx === 0);
        addPlane(windows, winGlassW, winGlassH, lit ? winLitMat : winGlassMat, LOT.frontX + 0.028, winCenterY, zc);
        // nền sau kính: sáng (đèn trong nhà) hoặc tối
        var innerLit = new THREE.Mesh(planeGeo(winGlassW - 0.10, winGlassH - 0.10), lit ? winGlowMat : winDarkMat);
        innerLit.rotation.y = Math.PI / 2;
        innerLit.position.set(LOT.frontX + 0.006, winCenterY, zc);
        windows.add(innerLit);
        addBox(windows, 0.10, 0.07, winW + 0.14, stucco, LOT.frontX + 0.045, row.bottom - 0.035, zc);

        // Bồn cây dài dưới cửa sổ tầng 2
        if (r === 0) {
          addBox(windows, 0.20, 0.16, winGlassW, terracotta, LOT.frontX + 0.10, row.bottom - 0.24, zc);
          addBox(windows, 0.18, 0.14, winGlassW - 0.06, grass, LOT.frontX + 0.10, row.bottom - 0.09, zc);
        }
      }
    }

    // Cục nóng điều hoà + 3 thanh tản nhiệt
    addBox(windows, 0.35, 0.45, 0.55, aluLight, LOT.frontX + 0.025, 6.20, 10.60);
    addBox(windows, 0.01, 0.02, 0.45, metalBlack, LOT.frontX + 0.205, 6.10, 10.60);
    addBox(windows, 0.01, 0.02, 0.45, metalBlack, LOT.frontX + 0.205, 6.20, 10.60);
    addBox(windows, 0.01, 0.02, 0.45, metalBlack, LOT.frontX + 0.205, 6.30, 10.60);

    // Ống thoát nước gắn trên tường hông (ngoài mặt tiền, không cắm vào trụ góc)
    addCyl(group, 0.05, 0.05, 9.15, 10, pipeMat, -16.60, 4.725, LOT.zMax + 0.055);
    addCyl(group, 0.05, 0.05, 0.35, 8, pipeMat, -16.60, 0.175, LOT.zMax + 0.055);

    // ============================================================
    // 7. SÂN HIÊN TRÊN VỈA HÈ
    // ============================================================
    var terrace = new THREE.Group();
    terrace.name = 'ft_cafe_van_terrace';
    group.add(terrace);

    // Thảm lát gạch nhẹ
    addBox(terrace, 0.91, 0.03, W, tileMat, LOT.frontX + 0.455, 0.015, midZ);

    // 2 bàn bistro tròn + 4 ghế nhỏ
    var bistroX = LOT.frontX + 0.54;              // -14.92
    var bistroZs = [7.85, 9.55];
    var chairOff = 0.35;
    for (i = 0; i < bistroZs.length; i++) {
      var bz = bistroZs[i];
      addCyl(terrace, 0.26, 0.26, 0.04, 18, woodCounter, bistroX, 0.70, bz);
      addCyl(terrace, 0.035, 0.045, 0.70, 10, metalBlack, bistroX, 0.35, bz);

      var offs = [-chairOff, chairOff];
      var j;
      for (j = 0; j < offs.length; j++) {
        var chz = bz + offs[j];
        addBox(terrace, 0.40, 0.05, 0.42, woodCounter, bistroX, 0.44, chz);
        var chBackZ = chz + (offs[j] < 0 ? -0.185 : 0.185);
        addBox(terrace, 0.40, 0.38, 0.05, woodCounter, bistroX, 0.64, chBackZ);
      }
    }

    // 2 chậu cây vuông sát trụ
    var planterZs = [LOT.zMin + 0.25, LOT.zMax - 0.25];
    for (i = 0; i < planterZs.length; i++) {
      addBox(terrace, 0.35, 0.38, 0.35, terracotta, LOT.frontX + 0.24, 0.19, planterZs[i]);
      addBox(terrace, 0.30, 0.32, 0.30, grass, LOT.frontX + 0.24, 0.52, planterZs[i]);
    }

    // Ghế riêng của Giám đốc giữa hai bàn (khớp cafeVanChairSpot bên enhancements)
    addBox(terrace, 0.40, 0.05, 0.42, woodCounter, bistroX, 0.44, midZ);
    addBox(terrace, 0.05, 0.38, 0.40, woodCounter, bistroX - 0.185, 0.64, midZ);
    addBox(terrace, 0.06, 0.40, 0.06, metalBlack, bistroX - 0.15, 0.22, midZ - 0.15);
    addBox(terrace, 0.06, 0.40, 0.06, metalBlack, bistroX + 0.15, 0.22, midZ - 0.15);

    // Bảng menu chữ A
    var boardZ = LOT.zMax - 0.75;                  // 10.35
    var boardX = LOT.frontX + 0.48;                // -14.98
    var panelA = addBox(terrace, 0.02, 0.70, 0.45, menuBlack, boardX - 0.06, 0.35, boardZ);
    panelA.rotation.z = -0.10;
    var panelB = addBox(terrace, 0.02, 0.70, 0.45, menuBlack, boardX + 0.06, 0.35, boardZ);
    panelB.rotation.z = 0.10;

    // ============================================================
    // 8. MÁI — TUM, BỒN NƯỚC, ĂNG-TEN
    // ============================================================
    var roof = new THREE.Group();
    roof.name = 'ft_cafe_van_roof';
    group.add(roof);

    var tumXMin = LOT.backX + 1.20;                // -18.40
    var tumXMax = tumXMin + 1.60;                  // -16.80
    var tumZMin = LOT.zMax - 1.80;                 // 9.30
    var tumZMax = tumZMin + 1.50;                  // 10.80
    var tumBottom = y4 + 0.02;                     // đặt trên mặt sàn thượng (trong lan can)
    var tumTop = tumBottom + 1.40;                 // 10.80
    var tumCX = (tumXMin + tumXMax) / 2;
    var tumCZ = (tumZMin + tumZMax) / 2;

    addBox(roof, 1.60, 1.40, 1.50, stucco, tumCX, (tumBottom + tumTop) / 2, tumCZ);
    addBox(roof, 0.04, 0.75, 0.55, woodDark, tumXMax + 0.01, tumBottom + 0.375, tumCZ);

    // Bồn nước inox + 4 chân
    addCyl(roof, 0.55, 0.55, 0.90, 20, stainless, tumCX, tumTop + 0.45, tumCZ);
    var legOff = 0.40;
    addBox(roof, 0.06, 0.30, 0.06, metalBlack, tumCX - legOff, tumTop + 0.15, tumCZ - legOff);
    addBox(roof, 0.06, 0.30, 0.06, metalBlack, tumCX + legOff, tumTop + 0.15, tumCZ - legOff);
    addBox(roof, 0.06, 0.30, 0.06, metalBlack, tumCX - legOff, tumTop + 0.15, tumCZ + legOff);
    addBox(roof, 0.06, 0.30, 0.06, metalBlack, tumCX + legOff, tumTop + 0.15, tumCZ + legOff);

    // Ăng-ten mảnh trên nóc tum
    addCyl(roof, 0.012, 0.012, 0.90, 6, metalBlack, tumXMax - 0.15, tumTop + 0.45, tumZMax - 0.15);

    return group;
  }

  window.FTCafeVan = {
    build: build,
    LOT: LOT
  };
})();
