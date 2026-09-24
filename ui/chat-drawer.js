/* ObjectStack 17.4 console presentation adapter. No separate chat state or API client. */
(() => {
  const config = document.querySelector('script[data-stratum-chat]');
  const appPath = `/_console/apps/${config.dataset.appId}`;
  const appLabel = decodeURIComponent(config.dataset.appLabel);
  const nativeLauncher = '[data-testid="console-chatbot-fab"]';
  const desktopPanel = '[data-testid="chat-dock-panel"]';
  const mobilePanel = '[data-testid="chat-dock-mobile-sheet"]';
  const panelSelector = `${desktopPanel}, ${mobilePanel}`;
  const sparkle = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z"/></svg>';
  const lock = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>';
  const prompts = [
    'Summarise the credit requests under review and their total amount.',
    'Which requests are high risk, and what do the reviewer notes say?',
    'Which requests are awaiting updated financial statements?',
    'Show the number and total amount of requests by review status.',
  ];
  let currentPanel;
  let frame;
  const focusedPanels = new WeakSet();
  const $ = (selector, parent = document) => parent.querySelector(selector);
  const element = (tag, className, text) => {
    const node = document.createElement(tag); node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const activePanel = () => [...document.querySelectorAll(panelSelector)].find(p => p.getBoundingClientRect().width && p.dataset.state !== 'closed');
  const close = () => {
    const panel = activePanel();
    const button = panel && ($('[data-testid="chat-dock-collapse"]', panel) || $(':scope > button.absolute', panel));
    button?.click();
    $('#stratum-chat-trigger')?.focus();
  };
  function focusComposer(panel, text) {
    const input = $('textarea', panel);
    if (!input) return;
    if (text !== undefined) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    input.focus();
  }
  function decorate(panel) {
    panel.id = 'stratum-chat-drawer';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Ask Stratum');
    const heading = element('section', 'stratum-chat-heading');
    heading.innerHTML = '<div class="stratum-chat-eyebrow">STRATUM ASSISTANT</div><h2>Ask Stratum</h2><div class="stratum-chat-badges"></div>';
    const scope = element('span', 'stratum-chat-scope');
    scope.innerHTML = lock;
    scope.append(document.createTextNode(`Scoped: ${appLabel}`));
    $('.stratum-chat-badges', heading).append(scope, element('span', 'stratum-chat-readonly', 'Read-only tools'));
    const closeButton = element('button', 'stratum-chat-close');
    closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close assistant');
    closeButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    closeButton.onclick = close; heading.append(closeButton);
    const history = element('button', 'stratum-chat-history');
    history.type = 'button'; history.setAttribute('aria-label', 'Open chat history');
    history.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l3 2"/></svg>';
    history.onclick = () => ($('[data-testid="chat-dock-maximize"]', panel) || $('[data-testid="chat-dock-mobile-maximize"]', panel))?.click();
    heading.append(history);
    const intro = element('section', 'stratum-chat-intro');
    const notice = element('div', 'stratum-chat-notice');
    notice.innerHTML = sparkle;
    notice.append(element('p', '', `AI answers use live ${appLabel} records you’re allowed to see. Check the linked source before acting. Stratum can summarise and explain; decisions stay with you.`));
    const suggested = element('div', 'stratum-chat-suggestions');
    suggested.append(element('p', 'stratum-chat-section-label', 'Suggested questions'));
    for (const prompt of prompts) {
      const button = element('button', 'stratum-chat-suggestion', prompt);
      button.type = 'button'; button.onclick = () => focusComposer(panel, prompt);
      suggested.append(button);
    }
    intro.append(notice, suggested);
    // Add siblings around React-owned content, without moving its nodes.
    panel.prepend(heading, intro);
    requestAnimationFrame(() => focusComposer(panel));
  }
  function sync() {
    frame = undefined;
    const inApp = location.pathname === appPath || location.pathname.startsWith(`${appPath}/`);
    const launcher = $(nativeLauncher);
    const header = document.querySelector('header');
    document.body.classList.toggle('stratum-chat-ui', inApp && !!launcher);
    if (!inApp || !launcher || !header) {
      $('#stratum-chat-trigger')?.remove(); $('#stratum-chat-backdrop')?.remove();
      currentPanel = undefined;
      return;
    }
    let trigger = $('#stratum-chat-trigger');
    if (!trigger) {
      trigger = element('button', 'stratum-chat-trigger'); trigger.id = 'stratum-chat-trigger';
      trigger.type = 'button'; trigger.innerHTML = `${sparkle}<span>Ask Stratum</span>`;
      trigger.setAttribute('aria-label', 'Ask Stratum'); trigger.title = 'Ask Stratum';
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', 'stratum-chat-drawer');
      trigger.onclick = () => activePanel() ? close() : $(nativeLauncher)?.click();
      header.append(trigger);
    }
    const panel = activePanel();
    trigger.setAttribute('aria-expanded', String(!!panel));
    if (panel && !$('.stratum-chat-heading', panel)) decorate(panel);
    if (panel) {
      // Native empty state is replaced visually; the native history and composer remain.
      const empty = panel.querySelector('[role="log"] .size-full.items-center:has(> div > h3)');
      if (empty) empty.classList.add('stratum-native-empty');
      const suggestions = $('.stratum-chat-suggestions', panel);
      if (suggestions) suggestions.hidden = !empty;
      const input = $('textarea', panel);
      if (input) {
        input.placeholder = 'Ask about your credit requests…'; input.setAttribute('aria-label', 'Ask about credit requests');
        if (!focusedPanels.has(panel)) { input.focus(); focusedPanels.add(panel); }
      }
      // Mobile uses ObjectStack's existing modal overlay and focus management.
      if (panel.matches(desktopPanel) && !$('#stratum-chat-backdrop')) {
        const backdrop = element('div', 'stratum-chat-backdrop'); backdrop.id = 'stratum-chat-backdrop';
        backdrop.setAttribute('aria-hidden', 'true'); backdrop.onclick = close; document.body.append(backdrop);
      }
      if (panel.matches(mobilePanel)) $('#stratum-chat-backdrop')?.remove();
    } else $('#stratum-chat-backdrop')?.remove();
    if (currentPanel && !panel) trigger.focus();
    currentPanel = panel;
  }
  // Observe route and native chat mounts, not keystrokes or streamed text changes.
  const observer = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(sync); });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('keydown', event => {
    if (!document.body.classList.contains('stratum-chat-ui')) return;
    const panel = activePanel();
    if (!panel) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    // Native mobile Sheet already traps focus; desktop rail becomes a modal drawer here.
    if (event.key === 'Tab' && panel.matches(desktopPanel)) {
      const focusable = [...panel.querySelectorAll('button, a[href], textarea, input, [tabindex="0"]')].filter(n => !n.disabled && n.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    }
  });
  window.addEventListener('resize', () => { if (!frame) frame = requestAnimationFrame(sync); });
  sync();
})();
