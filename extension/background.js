chrome.runtime.onMessage.addListener(m => {
  if (m.type !== 'send') return;
  chrome.tabs.create({url: m.url}, tab => {
    const f = (id, ch) => {
      if (id === tab.id && ch.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(f);
        setTimeout(() => chrome.scripting.executeScript({
          target: {tabId: id},
          func: (csv, nome) => window.postMessage({type: 'ADSRADAR_CSV', csv, nome}, '*'),
          args: [m.csv, m.nome]
        }), 600);
      }
    };
    chrome.tabs.onUpdated.addListener(f);
  });
});
