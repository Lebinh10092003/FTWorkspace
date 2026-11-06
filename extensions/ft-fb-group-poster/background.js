// Background Service Worker for FT FB Group Poster

chrome.runtime.onInstalled.addListener(() => {
  console.log("FT Workspace FB Group Poster Extension installed.");
  chrome.storage.local.get(["workspace_url"], (res) => {
    if (!res.workspace_url) {
      chrome.storage.local.set({
        workspace_url: "https://workspace.fermat.vn"
      });
    }
  });
});

// Lắng nghe thông điệp từ popup hoặc content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get_config") {
    chrome.storage.local.get(["workspace_url"], (res) => {
      sendResponse({ workspace_url: res.workspace_url || "https://workspace.fermat.vn" });
    });
    return true; // async
  }

  if (request.action === "save_config") {
    chrome.storage.local.set({ workspace_url: request.workspace_url }, () => {
      sendResponse({ status: "ok" });
    });
    return true;
  }
});
