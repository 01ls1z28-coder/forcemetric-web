/**
 * VelocityBench Hub — light interactivity (tilt).
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

})();
