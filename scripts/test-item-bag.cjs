const test = require('node:test');
const assert = require('node:assert/strict');

const { loadTsModule } = require('./load-ts-module.cjs');

// Test chạy trên chính src/components/fun/itemBagTypes.ts, không chép lại logic.
const { isPointInsideRect, canTriggerFlashbang, ITEM_DEFINITIONS, CAT_POOF_MS } = loadTsModule('src/components/fun/itemBagTypes.ts');

test('1. Ràng buộc an toàn bom choáng CS2 (WCAG 2.1 - Photosensitive Epilepsy)', async t => {
  await t.test('Không kích hoạt nếu đang trong trạng thái choáng', () => {
    const isFlashingNow = true;
    const lastFlash = 1000;
    const now = 2000;
    assert.equal(canTriggerFlashbang(isFlashingNow, lastFlash, now), false, 'Phải chặn ném tiếp khi đang choáng');
  });

  await t.test('Chặn kích hoạt lặp nếu chưa đủ thời gian an toàn (4.5s)', () => {
    const isFlashingNow = false;
    const lastFlash = 10000;
    const now1 = 12000; // Mới 2 giây
    const now2 = 14000; // Mới 4 giây
    assert.equal(canTriggerFlashbang(isFlashingNow, lastFlash, now1), false, 'Chặn khi mới 2s');
    assert.equal(canTriggerFlashbang(isFlashingNow, lastFlash, now2), false, 'Chặn khi mới 4s');
  });

  await t.test('Cho phép kích hoạt khi đã hết choáng và qua thời gian an toàn (>= 4.5s)', () => {
    const isFlashingNow = false;
    const lastFlash = 10000;
    const now = 15000; // 5 giây sau
    assert.equal(canTriggerFlashbang(isFlashingNow, lastFlash, now), true, 'Cho phép ném lần tiếp theo');
  });

  await t.test('Mốc đúng 4.5s được phép ném lại', () => {
    assert.equal(canTriggerFlashbang(false, 10000, 14499), false);
    assert.equal(canTriggerFlashbang(false, 10000, 14500), true);
  });
});

test('2. Kiểm tra logic hủy ném khi thả trong panel Túi đồ', async t => {
  const panelBounds = {
    left: 100,
    top: 200,
    right: 400,
    bottom: 500,
  };

  await t.test('Thả tay ở trong panel -> isPointInsideRect trả về true (HỦY NÉM)', () => {
    assert.equal(isPointInsideRect(250, 350, panelBounds), true, 'Tâm panel');
    assert.equal(isPointInsideRect(105, 205, panelBounds), true, 'Góc trên trái trong panel');
    assert.equal(isPointInsideRect(395, 495, panelBounds), true, 'Góc dưới phải trong panel');
  });

  await t.test('Thả tay ở ngoài panel -> isPointInsideRect trả về false (KÍCH HOẠT NÉM)', () => {
    assert.equal(isPointInsideRect(50, 350, panelBounds), false, 'Bên trái panel');
    assert.equal(isPointInsideRect(450, 350, panelBounds), false, 'Bên phải panel');
    assert.equal(isPointInsideRect(250, 150, panelBounds), false, 'Phía trên panel');
    assert.equal(isPointInsideRect(250, 550, panelBounds), false, 'Phía dưới panel');
    assert.equal(isPointInsideRect(0, 0, panelBounds), false, 'Góc màn hình');
  });

  await t.test('Xử lý an toàn khi bounds là null/undefined', () => {
    assert.equal(isPointInsideRect(100, 100, null), false);
    assert.equal(isPointInsideRect(100, 100, undefined), false);
  });
});

test('3. Kiểm tra danh mục vật phẩm Túi đồ', () => {
  assert.ok(ITEM_DEFINITIONS.smoke, 'Có Bom khói');
  assert.ok(ITEM_DEFINITIONS.flash, 'Có Bom choáng');
  assert.ok(ITEM_DEFINITIONS.cat, 'Có Mèo');

  assert.equal(ITEM_DEFINITIONS.smoke.durationMs, 5000, 'Khói xám duy trì 5s');
  assert.equal(ITEM_DEFINITIONS.flash.durationMs, 5000, 'Bom choáng duy trì 5s');
  assert.equal(ITEM_DEFINITIONS.cat.durationMs, 3000, 'Mèo xuất hiện và biến mất sau 3s');
  assert.ok(CAT_POOF_MS > 0 && CAT_POOF_MS < ITEM_DEFINITIONS.cat.durationMs, 'Mèo biến mất trước khi hết hiệu ứng');
});
