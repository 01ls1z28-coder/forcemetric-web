/**
 * VelocityBench Performance Telemetry speedometer.
 * Face matches PowerCurve BrassGauge dial:'speed' (LIVE 5aebfb9):
 * brushed brass bezel, charcoal glass, 260° sweep, white/red needle,
 * polished brass hub, MPH/KM/H + digital well from the same display value.
 * API unchanged: setValue / setUnits / start / stop. Live speed still comes from app.js.
 */
(function (global) {
  'use strict';

  function ForceMetricGauge(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.value = 0;
    this.display = 0;
    this.maxValue = 250;
    this.unitText = 'MPH';
    this.needleAngle = 140;
    this.targetAngle = 140;
    this._raf = null;
    this._running = false;
    this._resize();
    this.start();
  }

  ForceMetricGauge.prototype._resize = function () {
    var dpr = window.devicePixelRatio || 1;
    var css = Math.min(this.canvas.clientWidth || 260, this.canvas.clientHeight || 260);
    if (!css) css = 260;
    this.canvas.width = Math.round(css * dpr);
    this.canvas.height = Math.round(css * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._size = css;
    this.size = css;
  };

  ForceMetricGauge.prototype.setValue = function (v) {
    this.value = Math.max(0, Math.min(Math.round(v), this.maxValue));
    this.targetAngle = this._map(this.value, 0, this.maxValue, 140, 400);
  };

  /** mode: 'standard' (0–250 MPH) | 'metric' (0–400 km/h). Does not convert the needle value. */
  ForceMetricGauge.prototype.setUnits = function (mode) {
    if (mode === 'metric') {
      this.maxValue = 400;
      this.unitText = 'KM/H';
    } else {
      this.maxValue = 250;
      this.unitText = 'MPH';
    }
    this.setValue(this.value);
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
    // Same slew as PowerCurve BrassGauge so needle and digital stay locked
    this.display += (this.value - this.display) * 0.28;
    if (Math.abs(this.value - this.display) < 0.35) this.display = this.value;
    this.needleAngle = this._map(this.display, 0, this.maxValue, 140, 400);
    this.targetAngle = this._map(this.value, 0, this.maxValue, 140, 400);
  };

  ForceMetricGauge.prototype._map = function (value, inMin, inMax, outMin, outMax) {
    return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
  };

  ForceMetricGauge.prototype.draw = function () {
    var ctx = this.ctx;
    var w = this.size;
    var h = this.size;
    var cx = w / 2;
    var cy = h / 2;
    var R = Math.min(w, h) / 2 - 4;
    var fs;
    if (this.size >= 280) fs = 1;
    else {
      fs = this.size / 280;
      if (!isFinite(fs) || fs <= 0) fs = 1;
      if (fs < 0.78) fs = 0.78;
    }
    var start = 140;
    var sweep = 260;
    var min = 0;
    var max = this.maxValue;
    var redline = max * 0.9;
    function rad(d) { return (d * Math.PI) / 180; }
    function ang(v) {
      return start + ((v - min) / (max - min)) * sweep;
    }

    ctx.clearRect(0, 0, w, h);

    var bezel = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    bezel.addColorStop(0, 'rgba(255,236,196,0.95)');
    bezel.addColorStop(0.18, 'rgba(168,140,96,0.98)');
    bezel.addColorStop(0.42, 'rgba(236,214,170,0.95)');
    bezel.addColorStop(0.62, 'rgba(110,88,58,0.99)');
    bezel.addColorStop(0.82, 'rgba(210,186,145,0.92)');
    bezel.addColorStop(1, 'rgba(150,122,82,0.95)');
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = bezel; ctx.fill();

    ctx.beginPath(); ctx.arc(cx, cy, R - 1.2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,246,224,0.22)';
    ctx.lineWidth = 1.2; ctx.stroke();

    ctx.beginPath(); ctx.arc(cx, cy, R - 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#12100e'; ctx.fill();

    var face = ctx.createRadialGradient(cx, cy - R * 0.18, R * 0.04, cx, cy, R - 7);
    face.addColorStop(0, '#2a3140');
    face.addColorStop(0.28, '#1a202c');
    face.addColorStop(0.62, '#0e131a');
    face.addColorStop(1, '#050608');
    ctx.beginPath(); ctx.arc(cx, cy, R - 7, 0, Math.PI * 2);
    ctx.fillStyle = face; ctx.fill();

    var rimWash = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R - 7);
    rimWash.addColorStop(0, 'rgba(0,0,0,0)');
    rimWash.addColorStop(0.7, 'rgba(0,0,0,0)');
    rimWash.addColorStop(1, 'rgba(40,28,12,0.35)');
    ctx.beginPath(); ctx.arc(cx, cy, R - 7, 0, Math.PI * 2);
    ctx.fillStyle = rimWash; ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, R - 10, (Math.PI * 1.15), (Math.PI * 1.85));
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 6.5; ctx.lineCap = 'round'; ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.beginPath(); ctx.arc(cx, cy, R - 8.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(240,220,180,0.38)';
    ctx.lineWidth = 1.15; ctx.stroke();

    var redStart = ang(Math.min(redline, max));
    ctx.beginPath();
    ctx.arc(cx, cy, R - 16, rad(redStart), rad(start + sweep));
    ctx.strokeStyle = 'rgba(220, 48, 48, 0.92)';
    ctx.lineWidth = 5; ctx.lineCap = 'butt'; ctx.stroke();

    ctx.lineCap = 'butt';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var minorMph = 5;
    var midMph = 10;
    var majorMph = this.size < 200 ? 40 : 20;
    var v0 = 0;
    var v1 = Math.round(max);
    var labelMid = v1 <= 220 && this.size >= 280;
    var spOuter = R - 11 * fs;
    var spMajorIn = R - 30 * fs;
    var spMidIn = R - 23 * fs;
    var spMinorIn = R - 17 * fs;
    var spLabelR = R - (this.size < 220 ? 34 : 42) * fs;
    var spMajorFont = Math.max(8, Math.round(15 * fs * (this.size < 200 ? 0.92 : 1)));
    var spMidFont = Math.max(7, Math.round(10 * fs));
    var spMajorLw = Math.max(1.2, 2.4 * fs);
    var mph;
    for (mph = v0; mph <= v1; mph += minorMph) {
      var val = mph;
      var a = rad(ang(val));
      var onMajor = (val % majorMph === 0);
      var isMajorTick = onMajor || (val === v1);
      var isMidTick = !isMajorTick && (val % midMph === 0);
      var outer = spOuter;
      var inner = isMajorTick ? spMajorIn : (isMidTick ? spMidIn : spMinorIn);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.strokeStyle = isMajorTick ? '#f0e6d0' : (isMidTick ? 'rgba(232,215,176,0.58)' : 'rgba(232,215,176,0.32)');
      ctx.lineWidth = isMajorTick ? spMajorLw : 1;
      ctx.stroke();
      if (isMajorTick || (isMidTick && labelMid)) {
        var tx = cx + Math.cos(a) * spLabelR;
        var ty = cy + Math.sin(a) * spLabelR;
        if (isMajorTick) {
          ctx.fillStyle = '#eef3fa';
          ctx.font = 'bold ' + spMajorFont + 'px "Segoe UI", system-ui, sans-serif';
        } else {
          ctx.fillStyle = 'rgba(220,227,238,0.55)';
          ctx.font = spMidFont + 'px "Segoe UI", system-ui, sans-serif';
        }
        ctx.fillText(String(val), tx, ty);
      }
    }
    if ((v1 - v0) % minorMph !== 0) {
      var aMax = rad(ang(v1));
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(aMax) * spOuter, cy + Math.sin(aMax) * spOuter);
      ctx.lineTo(cx + Math.cos(aMax) * spMajorIn, cy + Math.sin(aMax) * spMajorIn);
      ctx.strokeStyle = '#f0e6d0';
      ctx.lineWidth = spMajorLw;
      ctx.stroke();
      ctx.fillStyle = '#eef3fa';
      ctx.font = 'bold ' + spMajorFont + 'px "Segoe UI", system-ui, sans-serif';
      ctx.fillText(String(v1), cx + Math.cos(aMax) * spLabelR, cy + Math.sin(aMax) * spLabelR);
    }

    ctx.fillStyle = 'rgba(232,215,176,0.75)';
    ctx.font = Math.max(7, Math.round(10 * fs)) + 'px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.unitText, cx, cy - R * 0.18);

    ctx.fillStyle = '#e8d7b0';
    ctx.font = 'bold ' + Math.max(8, Math.round(11 * fs)) + 'px "Segoe UI", sans-serif';
    ctx.fillText(this.unitText, cx, cy + R * 0.20);

    ctx.fillStyle = '#f4f7fb';
    var digSize = Math.max(14, Math.round(26 * fs));
    ctx.font = 'bold ' + digSize + 'px ui-monospace, "Cascadia Code", monospace';
    ctx.fillText(String(Math.round(this.display)), cx, cy + R * 0.40);

    var na = rad(ang(this.display));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(na);
    ctx.beginPath();
    ctx.moveTo(-R * 0.16, -2.2);
    ctx.lineTo(-R * 0.16, 2.2);
    ctx.lineTo(-4, 1.4);
    ctx.lineTo(-4, -1.4);
    ctx.closePath();
    ctx.fillStyle = '#8a7a58';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-4, -1.6);
    ctx.lineTo(R - 30, -0.7);
    ctx.lineTo(R - 26, 0);
    ctx.lineTo(R - 30, 0.7);
    ctx.lineTo(-4, 1.6);
    ctx.closePath();
    var needleGrad = ctx.createLinearGradient(0, 0, R - 28, 0);
    needleGrad.addColorStop(0, '#f4f7fb');
    needleGrad.addColorStop(0.75, '#f4f7fb');
    needleGrad.addColorStop(1, '#e02040');
    ctx.fillStyle = needleGrad;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(R - 34, -1.1);
    ctx.lineTo(R - 22, 0);
    ctx.lineTo(R - 34, 1.1);
    ctx.closePath();
    ctx.fillStyle = '#ff3355';
    ctx.fill();
    ctx.restore();

    var hub = ctx.createRadialGradient(cx - 2, cy - 2, 1, cx, cy, 11);
    hub.addColorStop(0, '#fff2d4');
    hub.addColorStop(0.35, '#d4b889');
    hub.addColorStop(0.7, '#8a7048');
    hub.addColorStop(1, '#2e2618');
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fillStyle = hub; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = '#07090c'; ctx.fill();
  };

  global.ForceMetricGauge = ForceMetricGauge;
})(typeof window !== 'undefined' ? window : globalThis);
