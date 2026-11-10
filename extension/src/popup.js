// The popup only reads the address of the current tab (activeTab), to offer
// "This document" when it is a Google Doc. It never reads the page itself.
const open = async (path) => { await chrome.tabs.create({ url: chrome.runtime.getURL(path) }); window.close(); };
const docId = (url) => (String(url || '').match(/^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,})/) || [])[1];

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const id = tab && docId(tab.url);
  const b = document.getElementById('doc');
  if (id) { b.hidden = false; b.addEventListener('click', () => open(`tabula.html?doc=${id}`)); }
});
document.getElementById('tabula').addEventListener('click', () => open('tabula.html'));
document.getElementById('files').addEventListener('click', () => open('tabularium.html'));
