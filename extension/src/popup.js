document.getElementById('open').addEventListener('click', async () => {
  await chrome.tabs.create({ url: chrome.runtime.getURL('tabularium.html') });
  window.close();
});
