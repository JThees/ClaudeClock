// ClaudeClock - Content Script v3.3.0
// This script injects the actual interceptor into the page context.

(function() {
  console.log('ClaudeClock v3.3.0: Content script loaded');

  // Inject the script into the page context
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injected.js');
  script.onload = function() {
    console.log('ClaudeClock: Injected script loaded into page');
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  console.log('ClaudeClock v3.3.0: Injection complete');
})();
