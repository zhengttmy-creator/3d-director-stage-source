let opening;
chrome.action.onClicked.addListener(() => {
  if (opening) return;
  opening = (async () => {
    const url = chrome.runtime.getURL('index.html');
    const contexts = await chrome.runtime.getContexts({contextTypes: ['TAB'], documentUrls: [url]});
    const existing = contexts.find(context => context.tabId >= 0);
    if (existing) {
      try {
        await chrome.tabs.update(existing.tabId, {active: true});
        await chrome.windows.update(existing.windowId, {focused: true});
        return;
      } catch (_) { /* The existing tab may have closed during the lookup. */ }
    }
    await chrome.tabs.create({url});
  })().catch(error => console.error('Could not open director', error)).finally(() => {opening = undefined;});
});
