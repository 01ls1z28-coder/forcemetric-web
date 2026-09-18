/**
 * VelocityBench Hub — light interactivity (tilt / parallax).
 * Static Pages only; respects prefers-reduced-motion; no tracking.
 */
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce.matches) return;
  if (window.matchMedia('(pointer: coarse)').matches) return;

  var cards = document.querySelectorAll('.tool-card[data-tilt]');
  if (!cards.length) return;

  var maxTilt = 5.5;

  function onMove(e) {
    var card = e.currentTarget;
    var rect = card.getBoundingClientRect();
    var x = (e.clientX - rect.left) / rect.width;
    var y = (e.clientY - rect.top) / rect.height;
    var rx = (0.5 - y) * maxTilt;
    var ry = (x - 0.5) * maxTilt;
    card.classList.add('is-tilting');
    card.style.transform =
      'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) +
      'deg) translateY(-6px) scale(1.012)';
  }

  function onLeave(e) {
    var card = e.currentTarget;
    card.classList.remove('is-tilting');
    card.style.transform = '';
  }

  for (var i = 0; i < cards.length; i++) {
    cards[i].addEventListener('mousemove', onMove);
    cards[i].addEventListener('mouseleave', onLeave);
  }

  /* Subtle hero parallax vs glow layer */
  var glow = document.querySelector('.bg-glow');
  var hero = document.querySelector('.hero');
  if (glow && hero) {
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY || 0;
        glow.style.transform = 'translate3d(0, ' + (y * 0.12).toFixed(1) + 'px, 0)';
        ticking = false;
      });
    }, { passive: true });
  }
})();
