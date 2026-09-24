(function () {
  const HERO_PHASES = ['discover', 'points', 'buffer', 'export'];
  const heroRuntime = document.getElementById('heroRuntime');
  if (!heroRuntime) return;

  let heroPhaseIndex = 0;
  window.setInterval(() => {
    heroPhaseIndex = (heroPhaseIndex + 1) % HERO_PHASES.length;
    heroRuntime.setAttribute('data-phase', HERO_PHASES[heroPhaseIndex]);
  }, 1600);
}());
