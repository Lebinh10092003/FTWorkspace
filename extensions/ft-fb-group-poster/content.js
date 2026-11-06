// Content script for FT FB Group Poster
// Runs on https://*.facebook.com/groups/*

(function() {
  chrome.storage.local.get(["pending_post", "workspace_url"], (data) => {
    if (!data.pending_post) return;
    const post = data.pending_post;

    // Render floating assistant badge
    createFloatingWidget(post, data.workspace_url || "https://workspace.fermat.vn");
  });

  function createFloatingWidget(post, baseUrl) {
    if (document.getElementById("ft-group-poster-widget")) return;

    const widget = document.createElement("div");
    widget.id = "ft-group-poster-widget";
    widget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      background: #ffffff;
      border: 2px solid #2563eb;
      border-radius: 8px;
      padding: 12px 16px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.2), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      width: 340px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #1e293b;
    `;

    widget.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <strong style="color:#2563eb; display:flex; align-items:center; gap:4px;">
          FT Workspace Group Helper
        </strong>
        <button id="ft-btn-close" style="background:none; border:none; cursor:pointer; font-size:16px; color:#64748b;">✕</button>
      </div>
      <div style="font-size:12px; font-weight:600; margin-bottom:4px; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${escapeHtml(post.text.slice(0, 50))}...
      </div>
      <div style="font-size:11px; color:#64748b; margin-bottom:10px;">
        Nội dung đã sẵn sàng trong Clipboard. Bạn có thể nhấn <strong>Ctrl + V</strong> vào khung đăng bài hoặc bấm nút bên dưới.
      </div>
      <div style="display:flex; gap:6px;">
        <button id="ft-btn-insert" style="background:#2563eb; color:white; border:none; border-radius:4px; padding:6px 10px; font-size:12px; cursor:pointer; font-weight:500; flex:1;">
          Tự động điền
        </button>
        <button id="ft-btn-done" style="background:#16a34a; color:white; border:none; border-radius:4px; padding:6px 10px; font-size:12px; cursor:pointer; font-weight:500;">
          Đã đăng xong ✓
        </button>
      </div>
    `;

    document.body.appendChild(widget);

    document.getElementById("ft-btn-close").addEventListener("click", () => {
      widget.remove();
    });

    // Tự động điền bài
    document.getElementById("ft-btn-insert").addEventListener("click", () => {
      insertTextIntoFacebookBox(post.text);
    });

    // Đánh dấu hoàn tất
    document.getElementById("ft-btn-done").addEventListener("click", async () => {
      try {
        const cleanBase = baseUrl.replace(/\/+$/, "");
        await fetch(`${cleanBase}/api/social-bot/group-queue/${post.id}/done`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ post_url: window.location.href })
        });
        chrome.storage.local.remove(["pending_post"]);
        widget.innerHTML = `
          <div style="color:#16a34a; font-weight:600; padding:10px 0; text-align:center;">
            ✓ Đã cập nhật bài viết thành công lên Workspace!
          </div>
        `;
        setTimeout(() => widget.remove(), 2500);
      } catch (err) {
        alert("Lỗi khi kết nối Workspace: " + err.message);
      }
    });
  }

  function insertTextIntoFacebookBox(text) {
    // Tìm các khung soạn thảo phổ biến của Facebook (contenteditable hoặc role=textbox)
    const activeBox = document.querySelector('div[role="textbox"][contenteditable="true"]') ||
                      document.querySelector('div[contenteditable="true"]') ||
                      document.activeElement;

    if (activeBox && activeBox.getAttribute("contenteditable") === "true") {
      activeBox.focus();
      document.execCommand("insertText", false, text);
    } else {
      // Nếu chưa mở khung soạn thảo, thử click vào nút "Bạn viết gì đi..."
      const clickTriggers = [
        ...document.querySelectorAll('span, div')
      ].filter(el => {
        const t = (el.innerText || "").trim().toLowerCase();
        return t === "bạn viết gì đi..." || t === "write something..." || t === "tạo bài viết công khai...";
      });

      if (clickTriggers.length > 0) {
        clickTriggers[0].click();
        setTimeout(() => {
          const newBox = document.querySelector('div[role="textbox"][contenteditable="true"]');
          if (newBox) {
            newBox.focus();
            document.execCommand("insertText", false, text);
          } else {
            alert("Đã mở khung đăng bài. Hãy nhấn Ctrl + V để dán nội dung bài viết.");
          }
        }, 800);
      } else {
        alert("Nội dung đã có trong Clipboard! Vui lòng bấm vào ô tạo bài viết và nhấn Ctrl + V.");
      }
    }
  }

  function escapeHtml(t) {
    if (!t) return "";
    return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
})();
