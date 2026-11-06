// Popup logic for FT Group Poster Extension

let allDrafts = [];
let allGroups = [];

document.addEventListener("DOMContentLoaded", () => {
  const urlInput = document.getElementById("workspace-url");
  const saveBtn = document.getElementById("btn-save-config");
  const refreshBtn = document.getElementById("btn-refresh");

  // Load saved workspace URL
  chrome.storage.local.get(["workspace_url"], (res) => {
    if (res.workspace_url) {
      urlInput.value = res.workspace_url;
    }
    fetchQueue();
  });

  saveBtn.addEventListener("click", () => {
    const val = urlInput.value.trim().replace(/\/+$/, "");
    chrome.storage.local.set({ workspace_url: val }, () => {
      showStatus("Đã lưu địa chỉ máy chủ Workspace!", "success");
      fetchQueue();
    });
  });

  refreshBtn.addEventListener("click", () => {
    fetchQueue();
  });
});

function showStatus(msg, type) {
  const container = document.getElementById("status-container");
  container.textContent = msg;
  container.className = `status-msg status-${type}`;
  setTimeout(() => {
    container.style.display = "none";
  }, 4000);
}

async function fetchQueue() {
  const container = document.getElementById("drafts-list");
  const countBadge = document.getElementById("drafts-count");
  container.innerHTML = '<div class="empty-msg">Đang tải dữ liệu...</div>';

  const res = await chrome.storage.local.get(["workspace_url"]);
  const baseUrl = (res.workspace_url || "https://workspace.fermat.vn").replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseUrl}/api/social-bot/group-queue`, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Lỗi kết nối máy chủ (${response.status})`);
    }

    const data = await response.json();
    allDrafts = data.drafts || [];
    allGroups = data.groups || [];

    countBadge.textContent = allDrafts.length;

    if (allDrafts.length === 0) {
      container.innerHTML = '<div class="empty-msg">Không có bài viết nào đang chờ đăng nhóm.</div>';
      return;
    }

    renderDrafts(allDrafts, allGroups);
  } catch (err) {
    countBadge.textContent = "!";
    container.innerHTML = `<div class="empty-msg" style="color:#b91c1c;">Không kết nối được: ${err.message}. Hãy kiểm tra địa chỉ Workspace hoặc đăng nhập.</div>`;
  }
}

function renderDrafts(drafts, groups) {
  const container = document.getElementById("drafts-list");
  container.innerHTML = "";

  drafts.forEach(draft => {
    const card = document.createElement("div");
    card.className = "card";

    let groupOptions = "";
    if (groups.length > 0) {
      groupOptions = groups.map(g => `<option value="${g.target_id}">${g.name}</option>`).join("");
    } else {
      groupOptions = '<option value="">(Chưa có nhóm nào cấu hình)</option>';
    }

    const fullText = [draft.title, draft.content, draft.hashtags].filter(Boolean).join("\n\n");

    card.innerHTML = `
      <div class="card-title">${escapeHtml(draft.title || "Bài viết không tiêu đề")}</div>
      <div class="card-desc">${escapeHtml(draft.content || "")}</div>
      <div class="card-actions">
        <select class="select-group" id="grp-select-${draft.id}">
          ${groupOptions}
        </select>
        <button class="btn btn-primary btn-sm btn-post-group" data-id="${draft.id}">
          Mở nhóm & Điền bài
        </button>
        <button class="btn btn-outline btn-sm btn-mark-done" data-id="${draft.id}">
          Đã đăng ✓
        </button>
      </div>
    `;

    // Nút mở nhóm và điền bài
    card.querySelector(".btn-post-group").addEventListener("click", () => {
      const select = card.querySelector(`#grp-select-${draft.id}`);
      const targetId = select.value;
      if (!targetId) {
        showStatus("Vui lòng chọn hoặc nhập nhóm mục tiêu!", "error");
        return;
      }

      // Copy to clipboard
      navigator.clipboard.writeText(fullText).then(() => {
        // Lưu active post để content script tự động điền nếu cần
        chrome.storage.local.set({
          pending_post: {
            id: draft.id,
            text: fullText,
            target_id: targetId,
            image_urls: draft.image_urls || []
          }
        }, () => {
          showStatus("Đã copy nội dung bài viết vào Clipboard!", "success");
          // Mở tab group Facebook
          const groupUrl = targetId.startsWith("http") ? targetId : `https://www.facebook.com/groups/${targetId}`;
          chrome.tabs.create({ url: groupUrl });
        });
      }).catch(err => {
        showStatus("Lỗi copy clipboard: " + err.message, "error");
      });
    });

    // Nút đánh dấu đã xong
    card.querySelector(".btn-mark-done").addEventListener("click", async () => {
      const res = await chrome.storage.local.get(["workspace_url"]);
      const baseUrl = (res.workspace_url || "https://workspace.fermat.vn").replace(/\/+$/, "");
      try {
        const postRes = await fetch(`${baseUrl}/api/social-bot/group-queue/${draft.id}/done`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        if (postRes.ok) {
          showStatus("Đã cập nhật trạng thái bài viết thành công!", "success");
          fetchQueue();
        } else {
          showStatus("Không cập nhật được trạng thái.", "error");
        }
      } catch (e) {
        showStatus("Lỗi: " + e.message, "error");
      }
    });

    container.appendChild(card);
  });
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
