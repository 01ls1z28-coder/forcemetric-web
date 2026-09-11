/**
 * VelocityBench Phase 30 — static GitHub-backed garage admin.
 * Token: sessionStorage only. Never writes main. No baked secrets.
 */
(function () {
  'use strict';

  var CONFIG = Object.freeze({
    owner: '01ls1z28-coder',
    repo: 'forcemetric-web',
    path: 'js/garage-data.js',
    baseRef: 'main',
    api: 'https://api.github.com',
    tokenKey: 'vb_garage_admin_pat',
    gateKey: 'vb_garage_admin_gate',
    /** Obscurity only — not security. Documented in page help. */
    obscurityPass: 'vb-garage',
    headerComment:
      '/**\n' +
      ' * Baked garage vehicles for VelocityBench (session defaults).\n' +
      ' * IsEv / IsForcedInduction audited for Phase 2 powertrain locks.\n' +
      ' * Phase 21: TireType enum (AllSeason=0,Summer=1,UHP=2,SoftCompound=3,Slicks=4).\n' +
      ' * Phase 3 legacy Street/Sport/Drag/Slick migrated — Street→AllSeason, Sport→Summer, DragTire/Slick→Slicks.\n' +
      ' * Phase 4: DrivetrainLossPercent calibrated (driver 175 era — superseded per-car by Phase 8B where cited).\n' +
      ' * Phase 8B batch 1–2: fleet recalib driver 200, Street, trap-first (batch1 ~50 + batch2 rest of fleet).\n' +
      ' * Phase 11: EV EngineLayout bake — FWD→Front, RWD→Rear, AWD→Dual (Rimac Nevera→Mid).\n' +
      ' * Phase 13: Transmission Auto|Manual|DCT; DCT-only loss recalib (driver 200, Street, trap-first).\n' +
      ' * Phase 21: five-tire grip ladder + full fleet recalib (driver 200, bake tire All-season default /\n' +
      ' *   Summer/UHP when clear, trap-first, TX Auto|Manual|DCT offsets). Soft/Slicks are user-selectable only.\n' +
      ' * Phase 29: lean TireType (OEM summer/UHP) + trap-first loss recalib; Soft/Slicks remain user-only.\n' +
      ' * Phase 30: editable via static GitHub-backed admin (review branches only; never main).\n' +
      ' */\n'
  });

  // Hard-fail: never ship / accept embedded tokens in page config or URL.
  if (Object.prototype.hasOwnProperty.call(CONFIG, 'token') || CONFIG.pat || CONFIG.githubToken) {
    document.body.innerHTML = '<p style="color:#ff3355;padding:24px;font-family:sans-serif">SECURITY STOP: embedded token detected in admin config. Refusing to run.</p>';
    throw new Error('embedded token forbidden');
  }

  var TOKEN_RE = /\b(ghp_|github_pat_)[A-Za-z0-9_]+/g;
  var href = String(location.href || '');
  if (TOKEN_RE.test(href)) {
    document.body.innerHTML = '<p style="color:#ff3355;padding:24px;font-family:sans-serif">SECURITY STOP: token-like string in URL. Refusing to run. Remove it and use session paste only.</p>';
    throw new Error('token in URL forbidden');
  }

  var KEY_ORDER = [
    'Name', 'Horsepower', 'WeightLbs', 'DragCoefficient', 'FrontalAreaSqFt',
    'DrivetrainLossPercent', 'TireType', 'DriveType', 'IsEv', 'IsForcedInduction',
    'EngineLayout', 'Differential', 'MaxSpeedMph', 'Source', 'Transmission'
  ];

  var TIRE_LABELS = {
    0: 'AllSeason',
    1: 'Summer',
    2: 'UHP',
    3: 'SoftCompound',
    4: 'Slicks'
  };

  var state = {
    vehicles: [],
    originalFile: '',
    selectedIndex: -1,
    baseCommitSha: '',
    baseTreeSha: '',
    dirty: false
  };

  var $ = function (id) { return document.getElementById(id); };

  function setStatus(el, msg, kind) {
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function getToken() {
    try { return sessionStorage.getItem(CONFIG.tokenKey) || ''; }
    catch (e) { return ''; }
  }

  function setToken(tok) {
    try {
      if (tok) sessionStorage.setItem(CONFIG.tokenKey, tok);
      else sessionStorage.removeItem(CONFIG.tokenKey);
    } catch (e) { /* ignore */ }
  }

  function gateOk() {
    try { return sessionStorage.getItem(CONFIG.gateKey) === '1'; }
    catch (e) { return false; }
  }

  function passGate() {
    try { sessionStorage.setItem(CONFIG.gateKey, '1'); } catch (e) { /* ignore */ }
  }

  function apiHeaders(token, extra) {
    var h = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (token) h.Authorization = 'Bearer ' + token;
    if (extra) {
      Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
    }
    return h;
  }

  async function gh(path, opts) {
    var token = getToken();
    if (!token) throw new Error('No PAT in sessionStorage. Paste and save first.');
    opts = opts || {};
    var res = await fetch(CONFIG.api + path, {
      method: opts.method || 'GET',
      headers: apiHeaders(token, opts.headers),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      var msg = (data && (data.message || data.error)) || res.statusText || 'GitHub API error';
      throw new Error(msg + ' (HTTP ' + res.status + ')');
    }
    return data;
  }

  function decodeBase64(b64) {
    var bin = atob(b64.replace(/\n/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }

  function encodeUtf8Base64(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function parseGarageFile(text) {
    var m = text.match(/window\.GARAGE_DATA\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
    if (!m) throw new Error('Could not parse window.GARAGE_DATA from js/garage-data.js');
    var arr = JSON.parse(m[1]);
    if (!Array.isArray(arr)) throw new Error('GARAGE_DATA is not an array');
    return arr;
  }

  function orderVehicle(v) {
    var out = {};
    KEY_ORDER.forEach(function (k) {
      if (k === 'MaxSpeedMph') {
        if (v.MaxSpeedMph !== undefined && v.MaxSpeedMph !== null && v.MaxSpeedMph !== '') {
          out.MaxSpeedMph = Number(v.MaxSpeedMph);
        }
        return;
      }
      if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = v[k];
    });
    Object.keys(v).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(out, k) && k !== 'MaxSpeedMph') out[k] = v[k];
    });
    return out;
  }

  function serializeGarage(vehicles) {
    var ordered = vehicles.map(orderVehicle);
    return CONFIG.headerComment + 'window.GARAGE_DATA = ' + JSON.stringify(ordered, null, 2) + '\n';
  }

  function blankVehicle() {
    return {
      Name: 'New Vehicle',
      Horsepower: 300,
      WeightLbs: 3500,
      DragCoefficient: 0.32,
      FrontalAreaSqFt: 24,
      DrivetrainLossPercent: 15,
      TireType: 0,
      DriveType: 'RWD',
      IsEv: false,
      IsForcedInduction: false,
      EngineLayout: 'Front',
      Differential: 'Open',
      Source: 'Admin add — cite sources before Seraph clear',
      Transmission: 'Auto'
    };
  }

  function renderList() {
    var q = ($('searchInput').value || '').trim().toLowerCase();
    var ul = $('vehicleList');
    ul.innerHTML = '';
    var visible = 0;
    state.vehicles.forEach(function (v, idx) {
      var name = String(v.Name || '');
      if (q && name.toLowerCase().indexOf(q) === -1) return;
      visible++;
      var li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.index = String(idx);
      if (idx === state.selectedIndex) li.classList.add('active');
      var tire = TIRE_LABELS[v.TireType] != null ? TIRE_LABELS[v.TireType] : String(v.TireType);
      li.innerHTML = '<span>' + escapeHtml(name) + '</span><span class="meta">' +
        escapeHtml(String(v.Horsepower || '?') + ' hp · ' + String(v.DriveType || '') + ' · ' + tire) + '</span>';
      li.addEventListener('click', function () { selectVehicle(idx); });
      ul.appendChild(li);
    });
    $('vehicleCount').textContent = '(' + visible + '/' + state.vehicles.length + ')';
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function selectVehicle(idx) {
    state.selectedIndex = idx;
    renderList();
    var v = state.vehicles[idx];
    if (!v) return;
    var form = $('vehicleForm');
    form.Name.value = v.Name || '';
    form.Horsepower.value = v.Horsepower;
    form.WeightLbs.value = v.WeightLbs;
    form.DragCoefficient.value = v.DragCoefficient;
    form.FrontalAreaSqFt.value = v.FrontalAreaSqFt;
    form.DrivetrainLossPercent.value = v.DrivetrainLossPercent;
    form.TireType.value = String(v.TireType != null ? v.TireType : 0);
    form.DriveType.value = v.DriveType || 'RWD';
    form.EngineLayout.value = v.EngineLayout || 'Front';
    form.Transmission.value = v.Transmission || 'Auto';
    form.Differential.value = v.Differential || 'Open';
    form.IsEv.checked = !!v.IsEv;
    form.IsForcedInduction.checked = !!v.IsForcedInduction;
    form.MaxSpeedMph.value = (v.MaxSpeedMph != null && v.MaxSpeedMph !== '') ? v.MaxSpeedMph : '';
    form.Source.value = v.Source || '';
    updateTireGuidance(Number(form.TireType.value));
    setStatus($('formStatus'), 'Editing #' + (idx + 1), '');
  }

  function updateTireGuidance(tire) {
    var el = $('tireGuidance');
    if (tire === 3 || tire === 4) {
      el.classList.add('warn');
      el.innerHTML = '⚠ SoftCompound/Slicks selected. Default bake should be <strong>AS / Summer / UHP</strong> unless Jorge explicitly wants Soft/Slicks.';
    } else {
      el.classList.remove('warn');
      el.innerHTML = 'TireType guidance: default bake should be <strong>AllSeason / Summer / UHP</strong> unless Jorge explicitly sets SoftCompound or Slicks (user-selectable only).';
    }
  }

  function readForm() {
    var form = $('vehicleForm');
    var v = {
      Name: form.Name.value.trim(),
      Horsepower: num(form.Horsepower.value),
      WeightLbs: num(form.WeightLbs.value),
      DragCoefficient: num(form.DragCoefficient.value),
      FrontalAreaSqFt: num(form.FrontalAreaSqFt.value),
      DrivetrainLossPercent: num(form.DrivetrainLossPercent.value),
      TireType: parseInt(form.TireType.value, 10),
      DriveType: form.DriveType.value,
      IsEv: !!form.IsEv.checked,
      IsForcedInduction: !!form.IsForcedInduction.checked,
      EngineLayout: form.EngineLayout.value,
      Differential: form.Differential.value,
      Source: form.Source.value.trim(),
      Transmission: form.Transmission.value
    };
    var ms = form.MaxSpeedMph.value.trim();
    if (ms !== '') v.MaxSpeedMph = num(ms);
    return v;
  }

  function num(x) {
    var n = Number(x);
    if (!isFinite(n)) throw new Error('Invalid number: ' + x);
    return n;
  }

  function applyForm(e) {
    if (e) e.preventDefault();
    try {
      if (state.selectedIndex < 0) throw new Error('Select or add a vehicle first');
      var v = readForm();
      if (!v.Name) throw new Error('Name required');
      state.vehicles[state.selectedIndex] = v;
      state.dirty = true;
      renderList();
      updateDiff();
      setStatus($('formStatus'), 'Applied to working copy', 'ok');
    } catch (err) {
      setStatus($('formStatus'), String(err.message || err), 'err');
    }
  }

  function updateDiff() {
    var pre = $('diffPreview');
    if (!state.originalFile) {
      pre.textContent = 'Load garage first.';
      return;
    }
    try {
      var next = serializeGarage(state.vehicles);
      if (next === state.originalFile) {
        pre.textContent = 'No file changes vs loaded main snapshot.';
        return;
      }
      var orig = parseGarageFile(state.originalFile);
      var oMap = {};
      orig.forEach(function (v) { oMap[v.Name] = v; });
      var nMap = {};
      state.vehicles.forEach(function (v) { nMap[v.Name] = v; });
      var added = [];
      var removed = [];
      var changed = [];
      state.vehicles.forEach(function (v) {
        if (!oMap[v.Name]) added.push(v.Name);
        else if (JSON.stringify(orderVehicle(oMap[v.Name])) !== JSON.stringify(orderVehicle(v))) changed.push(v.Name);
      });
      orig.forEach(function (v) {
        if (!nMap[v.Name]) removed.push(v.Name);
      });
      // also detect renames roughly via index length
      var lines = [];
      lines.push('Vehicles: ' + orig.length + ' → ' + state.vehicles.length);
      lines.push('Added (' + added.length + '): ' + (added.slice(0, 20).join(', ') || '—') + (added.length > 20 ? '…' : ''));
      lines.push('Removed (' + removed.length + '): ' + (removed.slice(0, 20).join(', ') || '—') + (removed.length > 20 ? '…' : ''));
      lines.push('Changed (' + changed.length + '): ' + (changed.slice(0, 30).join(', ') || '—') + (changed.length > 30 ? '…' : ''));
      lines.push('');
      lines.push('File bytes: ' + state.originalFile.length + ' → ' + next.length);
      pre.textContent = lines.join('\n');
    } catch (err) {
      pre.textContent = 'Diff error: ' + (err.message || err);
    }
  }

  async function loadGarage() {
    setStatus($('authStatus'), 'Loading…', '');
    $('successBox').hidden = true;
    try {
      var ref = await gh('/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/git/ref/heads/' + CONFIG.baseRef);
      var commitSha = ref.object && ref.object.sha;
      if (!commitSha) throw new Error('Could not resolve ' + CONFIG.baseRef);
      var commit = await gh('/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/git/commits/' + commitSha);
      state.baseCommitSha = commitSha;
      state.baseTreeSha = commit.tree && commit.tree.sha;

      var content = await gh(
        '/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/contents/' +
        encodeURIComponent(CONFIG.path).replace(/%2F/g, '/') +
        '?ref=' + encodeURIComponent(CONFIG.baseRef)
      );
      if (!content || !content.content) throw new Error('Empty contents response');
      var text = decodeBase64(content.content);
      state.vehicles = parseGarageFile(text);
      state.originalFile = text;
      state.dirty = false;
      state.selectedIndex = state.vehicles.length ? 0 : -1;
      $('editorPanel').hidden = false;
      $('commitPanel').hidden = false;
      renderList();
      if (state.selectedIndex >= 0) selectVehicle(state.selectedIndex);
      updateDiff();
      setStatus($('authStatus'), 'Loaded ' + state.vehicles.length + ' vehicles from ' + CONFIG.baseRef + ' @ ' + commitSha.slice(0, 7), 'ok');
    } catch (err) {
      setStatus($('authStatus'), String(err.message || err), 'err');
    }
  }

  function branchNameUtc() {
    var d = new Date();
    function p(n) { return String(n).padStart(2, '0'); }
    return 'review/vb-garage-admin-' +
      d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + '-' +
      p(d.getUTCHours()) + p(d.getUTCMinutes());
  }

  async function commitReviewBranch() {
    $('successBox').hidden = true;
    setStatus($('commitStatus'), 'Committing…', '');
    try {
      if (!state.vehicles.length && !state.originalFile) throw new Error('Load garage first');
      // Ensure latest form edits applied if selection exists
      if (state.selectedIndex >= 0) {
        try { state.vehicles[state.selectedIndex] = readForm(); state.dirty = true; } catch (e) { /* keep prior */ }
      }

      var newContent = serializeGarage(state.vehicles);
      if (newContent === state.originalFile) throw new Error('No changes to commit');

      // Refresh base tip (never assume stale)
      var ref = await gh('/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/git/ref/heads/' + CONFIG.baseRef);
      var baseSha = ref.object.sha;
      if (baseSha === CONFIG.baseRef || !baseSha) throw new Error('Invalid base SHA');
      var baseCommit = await gh('/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/git/commits/' + baseSha);
      var baseTree = baseCommit.tree.sha;

      var branch = branchNameUtc();
      // SAFETY: never allow targeting main
      if (branch === 'main' || branch === 'master' || branch === CONFIG.baseRef) {
        throw new Error('SECURITY STOP: refusing to write protected base ref');
      }
      if (!/^review\/vb-garage-admin-\d{8}-\d{4}$/.test(branch)) {
        throw new Error('SECURITY STOP: unexpected branch name ' + branch);
      }

      var blob = await gh('/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/git/blobs', {
        method: 'POST',
        body: { content: encodeUtf8Base64(newContent), encoding: 'base64' }
      });

      var tree = await gh('/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/git/trees', {
        method: 'POST',
        body: {
          base_tree: baseTree,
          tree: [{
            path: CONFIG.path,
            mode: '100644',
            type: 'blob',
            sha: blob.sha
          }]
        }
      });

      var msg = ($('commitMessage').value || '').trim() || 'Garage admin: update js/garage-data.js';
      // Refuse commit messages that imply main deploy
      if (/\b(to main|into main|push main|deploy pages)\b/i.test(msg)) {
        throw new Error('SECURITY STOP: commit message implies main/Pages write');
      }

      var commit = await gh('/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/git/commits', {
        method: 'POST',
        body: {
          message: msg,
          tree: tree.sha,
          parents: [baseSha]
        }
      });

      // Create NEW ref only — never PATCH refs/heads/main
      var refPath = 'refs/heads/' + branch;
      if (refPath === 'refs/heads/main' || refPath === 'refs/heads/master') {
        throw new Error('SECURITY STOP: refused main ref update');
      }
      await gh('/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/git/refs', {
        method: 'POST',
        body: {
          ref: refPath,
          sha: commit.sha
        }
      });

      var prUrl = '';
      if ($('openPr').checked) {
        try {
          var pr = await gh('/repos/' + CONFIG.owner + '/' + CONFIG.repo + '/pulls', {
            method: 'POST',
            body: {
              title: msg,
              head: branch,
              base: CONFIG.baseRef,
              body:
                '## Garage admin update (Phase 30)\n\n' +
                'Static admin commit. **Seraph must clear before Merovingian deploys.**\n\n' +
                '- Path: `' + CONFIG.path + '`\n' +
                '- Branch: `' + branch + '`\n' +
                '- Commit: `' + commit.sha + '`\n'
            }
          });
          prUrl = pr.html_url || '';
        } catch (prErr) {
          setStatus($('commitStatus'), 'Branch committed; PR skipped: ' + (prErr.message || prErr), '');
        }
      }

      state.originalFile = newContent;
      state.dirty = false;
      updateDiff();

      $('outBranch').textContent = branch;
      $('outSha').textContent = commit.sha;
      if (prUrl) {
        $('outPrWrap').hidden = false;
        $('outPr').href = prUrl;
        $('outPr').textContent = prUrl;
      } else {
        $('outPrWrap').hidden = true;
      }
      $('successBox').hidden = false;
      setStatus($('commitStatus'), 'Done — review branch created (main untouched)', 'ok');
    } catch (err) {
      setStatus($('commitStatus'), String(err.message || err), 'err');
    }
  }

  function showApp() {
    $('gatePanel').hidden = true;
    $('app').hidden = false;
    if (getToken()) {
      $('tokenInput').placeholder = '•••• PAT already in session — paste to replace';
      setStatus($('authStatus'), 'PAT present in sessionStorage', 'ok');
    }
  }

  function initGate() {
    var params = new URLSearchParams(location.search);
    var key = params.get('key') || '';
    if (gateOk() || (key && key === CONFIG.obscurityPass)) {
      if (key && key === CONFIG.obscurityPass) passGate();
      showApp();
      return;
    }
    $('gatePanel').hidden = false;
    $('app').hidden = true;
    $('gateSubmit').addEventListener('click', function () {
      var v = ($('gateInput').value || '').trim();
      if (v === CONFIG.obscurityPass) {
        passGate();
        showApp();
      } else {
        $('gateError').hidden = false;
        $('gateError').textContent = 'Wrong passphrase (obscurity only).';
      }
    });
    $('gateInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('gateSubmit').click();
    });
  }

  function bind() {
    $('btnSaveToken').addEventListener('click', function () {
      var tok = ($('tokenInput').value || '').trim();
      if (!tok) {
        setStatus($('authStatus'), 'Paste a PAT first', 'err');
        return;
      }
      if (!/^(ghp_|github_pat_)/.test(tok)) {
        setStatus($('authStatus'), 'Does not look like a GitHub PAT (ghp_ / github_pat_)', 'err');
        return;
      }
      // Refuse accidental localStorage
      try { localStorage.removeItem(CONFIG.tokenKey); } catch (e) { /* ignore */ }
      setToken(tok);
      $('tokenInput').value = '';
      setStatus($('authStatus'), 'Saved to sessionStorage (clears on tab close)', 'ok');
    });

    $('btnClearToken').addEventListener('click', function () {
      setToken('');
      try { localStorage.removeItem(CONFIG.tokenKey); } catch (e) { /* ignore */ }
      setStatus($('authStatus'), 'Token cleared from session', '');
    });

    $('btnLoadGarage').addEventListener('click', function () { loadGarage(); });
    $('searchInput').addEventListener('input', function () { renderList(); });
    $('vehicleForm').addEventListener('submit', applyForm);
    $('tireTypeSelect').addEventListener('change', function () {
      updateTireGuidance(Number($('tireTypeSelect').value));
    });

    $('btnAdd').addEventListener('click', function () {
      state.vehicles.push(blankVehicle());
      state.selectedIndex = state.vehicles.length - 1;
      state.dirty = true;
      renderList();
      selectVehicle(state.selectedIndex);
      updateDiff();
    });

    $('btnClone').addEventListener('click', function () {
      if (state.selectedIndex < 0) return;
      var copy = JSON.parse(JSON.stringify(state.vehicles[state.selectedIndex]));
      copy.Name = (copy.Name || 'Vehicle') + ' (copy)';
      state.vehicles.splice(state.selectedIndex + 1, 0, copy);
      state.selectedIndex = state.selectedIndex + 1;
      state.dirty = true;
      renderList();
      selectVehicle(state.selectedIndex);
      updateDiff();
    });

    $('btnDelete').addEventListener('click', function () {
      if (state.selectedIndex < 0) return;
      var name = state.vehicles[state.selectedIndex].Name || 'vehicle';
      if (!confirm("Delete \"" + name + "\"? This only affects the working copy until you commit.")) return;
      state.vehicles.splice(state.selectedIndex, 1);
      state.selectedIndex = Math.min(state.selectedIndex, state.vehicles.length - 1);
      state.dirty = true;
      renderList();
      if (state.selectedIndex >= 0) selectVehicle(state.selectedIndex);
      else $('vehicleForm').reset();
      updateDiff();
    });

    $('btnCommit').addEventListener('click', function () { commitReviewBranch(); });
    $('btnHelp').addEventListener('click', function () { $('helpDialog').showModal(); });
    $('helpClose').addEventListener('click', function () { $('helpDialog').close(); });
  }

  initGate();
  bind();
})();
