(() => {
  const { visualViewport } = window;
  if (!visualViewport) {
    return;
  }

  // iOS 26 WebKit visualViewport offsetTop workaround.
  const root = document.documentElement;
  root.classList.add("vv-enabled");

  let rafId = 0;

  const updateVars = () => {
    rafId = 0;
    root.style.setProperty("--vv-offset-top", `${visualViewport.offsetTop}px`);
    root.style.setProperty("--vv-height", `${visualViewport.height}px`);
  };

  const scheduleUpdate = () => {
    if (rafId) {
      return;
    }
    rafId = requestAnimationFrame(updateVars);
  };

  const handleFocusOut = () => {
    scheduleUpdate();
    setTimeout(scheduleUpdate, 50);
    setTimeout(scheduleUpdate, 250);
  };

  visualViewport.addEventListener("resize", scheduleUpdate);
  visualViewport.addEventListener("scroll", scheduleUpdate);
  window.addEventListener("orientationchange", scheduleUpdate);
  document.addEventListener("focusin", scheduleUpdate);
  document.addEventListener("focusout", handleFocusOut);

  scheduleUpdate();
})();
