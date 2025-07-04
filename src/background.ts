// src/background.ts 
// Listen for the extension's icon to be clicked
browser.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    // Send a message to the content script in the active tab
    browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_GADGET' });
  }
}); 