/**
 * ForceMetric analog speedometer — classy modern face, 0–250 MPH.
 * API: setValue / start / stop (unchanged for app.js).
 */
(function (global) {
  'use strict';

  function ForceMetricGauge(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.value = 0;
    this.maxValue = 250;
    this.unitText = 'MPH';
    this.needleAngle = 135;
    this.targetAngle = 135;
    this._raf = null;
    this._running = false;
    this._resize();
    this.start();
  }

  ForceMetricGauge.prototype._resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var css = Math.min(this.canvas.clientWidth || 280, this.canvas.clientHeight || 280);
    if (!css) css = 280;
    this.canvas.width = Math.round(css * dpr);
    this.canvas.height = Math.round(css * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._size = css;
  };

  ForceMetricGauge.prototype.setValue = function (v) {
    this.value = Math.max(0, Math.min(Math.round(v), this.maxValue));
    this.targetAngle = this._map(this.value, 0, this.maxValue, 135, 405);
  };

  ForceMetricGauge.prototype.start = function () {
    if (this._running) return;
    this._running = true;
    var self = this;
    function loop() {
      if (!self._running) return;
      self._animateNeedle();
      self.draw();
      self._raf = requestAnimationFrame(loop);
    }
    this._raf = requestAnimationFrame(loop);
  };

  ForceMetricGauge.prototype.stop = function () {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  };

  ForceMetricGauge.prototype._animateNeedle = function () {
    var speed = 0.18;
    this.needleAngle = this.needleAngle + (this.targetAngle - this.needleAngle) * speed;
    if (Math.abs(this.needleAngle - this.targetAngle) < 0.08) {
      this.needleAngle = this.targetAngle;
    }
  };

  ForceMetricGauge.prototype._map = function (value, inMin, inMax, outMin, outMax) {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
  };

  ForceMetricGauge.prototype.draw = function () {
    var ctx = this.ctx;
    var w = this._size;
    var h = this._size;
    var cx = w / 2;
    var cy = h / 2;
    var radius = Math.min(w, h) / 2 - 6;
    var startAngle = 135;
    var sweepAngle = 270;

    function degToRad(d) {
      return (d * Math.PI) / 180;
    }

    ctx.clearRect(0, 0, w, h);

    // Outer champagne bezel
    var bezel = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    bezel.addColorStop(0, '#d7c4a0');
    bezel.addColorStop(0.35, '#8f7a55');
    bezel.addColorStop(0.55, '#f0e2c4');
    bezel.addColorStop(1, '#6a5738');
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = bezel;
    ctx.fill();

    // Inner dark ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 4, 0, Math.PI * 2);
    ctx.fillStyle = '#12151c';
    ctx.fill();

    // Face
    var faceR = radius - 8;
    var face = ctx.createRadialGradient(cx - faceR * 0.25, cy - faceR * 0.3, faceR * 0.1, cx, cy, faceR);
    face.addColorStop(0, '#2a303c');
    face.addColorStop(0.55, '#151922');
    face.addColorStop(1, '#0a0c11');
    ctx.beginPath();
    ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
    ctx.fillStyle = face;
    ctx.fill();

    // Subtle inner rim highlight
    ctx.beginPath();
    ctx.arc(cx, cy, faceR - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(230, 210, 170, 0.22)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Thin performance arc (elegant, not chunky)
    var arcR = faceR - 18;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.5;
    function strokeArc(color, fromFrac, toFrac) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.arc(
        cx,
        cy,
        arcR,
        degToRad(startAngle + sweepAngle * fromFrac),
        degToRad(startAngle + sweepAngle * toFrac),
        false
      );
      ctx.stroke();
    }
    strokeArc('rgba(72, 187, 120, 0.85)', 0, 0.45);
    strokeArc('rgba(234, 179, 8, 0.85)', 0.45, 0.75);
    strokeArc('rgba(239, 68, 68, 0.9)', 0.75, 1);

    // Ticks + numerals
    for (var i = 0; i <= this.maxValue; i += 5) {
      var angle = this._map(i, 0, this.maxValue, startAngle, startAngle + sweepAngle);
      var rad = degToRad(angle);
      var major = i % 50 === 0;
      var mid = i % 25 === 0;
      var tickLen = major ? 14 : mid ? 10 : 6;
      var inner = faceR - 10 - tickLen;
      var outer = faceR - 10;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * inner, cy + Math.sin(rad) * inner);
      ctx.lineTo(cx + Math.cos(rad) * outer, cy + Math.sin(rad) * outer);
      ctx.strokeStyle = major ? 'rgba(245, 240, 230, 0.95)' : 'rgba(180, 190, 210, 0.55)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.stroke();

      if (major) {
        var labelR = faceR - 34;
        var lx = cx + Math.cos(rad) * labelR;
        var ly = cy + Math.sin(rad) * labelR;
        ctx.fillStyle = 'rgba(236, 230, 214, 0.92)';
        ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i), lx, ly);
      }
    }

    // Needle shadow
    var nRad = degToRad(this.needleAngle);
    var tip = faceR - 28;
    var nx = cx + Math.cos(nRad) * tip;
    var ny = cy + Math.sin(nRad) * tip;
    var bx = cx - Math.cos(nRad) * 18;
    var by = cy - Math.sin(nRad) * 18;

    ctx.save();
    ctx.translate(1.5, 2);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.restore();

    // Needle body (polished red/steel)
    var needleGrad = ctx.createLinearGradient(bx, by, nx, ny);
    needleGrad.addColorStop(0, '#f8d7d7');
    needleGrad.addColorStop(0.35, '#e11d48');
    needleGrad.addColorStop(1, '#7f1d1d');
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(nx, ny);
    ctx.strokeStyle = needleGrad;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Hub
    var hub = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 9);
    hub.addColorStop(0, '#f5efe2');
    hub.addColorStop(0.55, '#b09a6e');
    hub.addColorStop(1, '#4a3d28');
    ctx.beginPath();
    ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1d24';
    ctx.fill();

    // Digital window
    var boxW = 72;
    var boxH = 28;
    var boxX = cx - boxW / 2;
    var boxY = cy + faceR * 0.42;
    ctx.beginPath();
    roundRect(ctx, boxX, boxY, boxW, boxH, 6);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(215, 196, 160, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '700 16px ui-monospace, Cascadia Code, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.value), cx, boxY + boxH / 2 - 1);

    ctx.fillStyle = 'rgba(200, 210, 225, 0.75)';
    ctx.font = '600 9px "Segoe UI", system-ui, sans-serif';
    ctx.fillText(this.unitText, cx, boxY + boxH + 10);
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  global.ForceMetricGauge = ForceMetricGauge;
})(typeof window !== 'undefined' ? window : globalThis);
