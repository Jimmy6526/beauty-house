var BH = (function () {
  /* ---------------- Theme (applied immediately to avoid flash) ---------------- */
  var THEME_KEY = 'bh_theme';
  /* Light ("نهاري") is the default everywhere; dark ("ليلي") is an explicit choice saved on this device. */
  function getStoredTheme() { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } }
  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode === 'dark' ? 'dark' : 'light');
  }
  (function initThemeEarly() {
    applyTheme(getStoredTheme());
  })();

  function currentTheme() { return getStoredTheme() === 'dark' ? 'dark' : 'light'; }

  var themeListeners = [];
  function setTheme(mode) {
    mode = mode === 'dark' ? 'dark' : 'light';
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    applyTheme(mode);
    themeListeners.forEach(function (fn) { try { fn(mode); } catch (e) {} });
  }

  var SVG_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
  var SVG_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
  function themeToggleIcon(mode) { return mode === 'dark' ? SVG_MOON : SVG_SUN; }

  function initThemeToggle(btnId) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    function render() {
      var m = currentTheme();
      btn.innerHTML = themeToggleIcon(m);
      btn.title = m === 'dark' ? 'الوضع الليلي — اضغط للتحويل إلى النهاري' : 'الوضع النهاري — اضغط للتحويل إلى الليلي';
      btn.setAttribute('aria-label', btn.title);
    }
    btn.addEventListener('click', function () { setTheme(currentTheme() === 'dark' ? 'light' : 'dark'); });
    themeListeners.push(render);
    render();
  }

  /* Labeled day/night switch for pages without a sidebar (login, setup, activation). */
  function mountThemePill() {
    if (document.getElementById('bhThemePill') || document.querySelector('.sidebar')) return;
    var pill = document.createElement('div');
    pill.className = 'bh-theme-pill'; pill.id = 'bhThemePill'; pill.setAttribute('role', 'group'); pill.setAttribute('aria-label', 'المظهر');
    pill.innerHTML = '<button type="button" data-m="light">' + SVG_SUN + 'نهاري</button><button type="button" data-m="dark">' + SVG_MOON + 'ليلي</button>';
    function render() { var m = currentTheme(); Array.prototype.forEach.call(pill.children, function (b) { b.classList.toggle('on', b.getAttribute('data-m') === m); }); }
    pill.addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setTheme(b.getAttribute('data-m')); });
    themeListeners.push(render); render();
    document.body.appendChild(pill);
  }

  /* ---------------- Designer credit (quiet) + About dialog ---------------- */
  var CREDIT = { name: 'م. محمد جمال الدين', phone: '+249965269898', email: 'jamalmohamed942@gmail.com' };
  function showAbout() {
    if (document.getElementById('bhAbout')) return;
    var back = document.createElement('div');
    back.className = 'bh-about-back'; back.id = 'bhAbout';
    back.innerHTML = '<div class="bh-about" role="dialog" aria-modal="true" aria-label="حول النظام">' +
      '<img src="/branding/icon-256.png" alt=""><h3>نظام نوفا الجمال</h3><div class="sub">لإدارة الصالونات ومحلات التجميل · الإصدار 1.0.0</div>' +
      '<div class="who">تصميم وتطوير</div><div class="name">المهندس محمد جمال الدين</div>' +
      '<div class="lines"><a href="tel:' + CREDIT.phone + '">' + CREDIT.phone + '</a><a href="mailto:' + CREDIT.email + '">' + CREDIT.email + '</a></div>' +
      '<button type="button" class="close">إغلاق</button></div>';
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    back.addEventListener('click', function (e) { if (e.target === back || e.target.classList.contains('close')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(back);
  }
  function mountCredit() {
    if (document.getElementById('bhCredit') || document.querySelector('.credit, .credit-line')) return;
    var btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'bhCredit'; btn.className = 'bh-credit';
    btn.title = 'تصميم وتطوير: المهندس محمد جمال الدين — ' + CREDIT.phone;
    btn.textContent = 'تصميم وتطوير · ' + CREDIT.name;
    btn.addEventListener('click', showAbout);
    var sb = document.querySelector('.sidebar');
    if (sb) sb.appendChild(btn); else { btn.className += ' bh-credit-fixed'; document.body.appendChild(btn); }
  }
  function mountChrome() { mountThemePill(); mountCredit(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountChrome);
  else mountChrome();

  /* ---------------- Live clock ---------------- */
  var WEEKDAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var MONTH_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

  function startClock(timeId, dateId) {
    function tick() {
      var now = new Date();
      var h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
      var period = h >= 12 ? 'م' : 'ص';
      var h12 = h % 12 || 12;
      var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
      var timeEl = document.getElementById(timeId);
      if (timeEl) timeEl.textContent = pad(h12) + ':' + pad(m) + ':' + pad(s) + ' ' + period;
      if (dateId) {
        var dateEl = document.getElementById(dateId);
        if (dateEl) dateEl.textContent = WEEKDAY_AR[now.getDay()] + '، ' + now.getDate() + ' ' + MONTH_AR[now.getMonth()] + ' ' + now.getFullYear();
      }
    }
    tick();
    setInterval(tick, 1000);
  }

  /* ---------------- API ---------------- */
  async function api(path, opts) {
    opts = opts || {};
    var fetchOpts = {
      method: opts.method || 'GET',
      credentials: 'include'
    };
    if (opts.body !== undefined) {
      fetchOpts.headers = { 'Content-Type': 'application/json' };
      fetchOpts.body = JSON.stringify(opts.body);
    }
    var res = await fetch(path, fetchOpts);
    if (res.status === 402 && !location.pathname.endsWith('activate.html')) {
      window.location.href = 'activate.html';
      throw new Error('license');
    }
    if (res.status === 401) {
      if (!location.pathname.endsWith('login.html') && location.pathname !== '/') {
        window.location.href = 'login.html';
      }
      throw new Error('unauthorized');
    }
    var data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) {
      var err = new Error((data && data.error) || 'حدث خطأ');
      err.data = data;
      throw err;
    }
    return data;
  }

  var settingsCache = null;
  async function getSettings(force) {
    if (settingsCache && !force) return settingsCache;
    settingsCache = await api('/api/settings');
    applyBranding(settingsCache);
    return settingsCache;
  }

  function money(n) {
    var num = Number(n) || 0;
    var label = (settingsCache && settingsCache.currency_label) || '';
    return num.toLocaleString('en-US', { maximumFractionDigits: 0 }) + (label ? ' ' + label : '');
  }

  /* ---------------- Branding (shop name + logo) applied system-wide ---------------- */
  function applyBranding(settings) {
    var name = (settings && settings.shop_name) || '';
    var logo = settings && settings.logo;
    document.querySelectorAll('.sb-brand .name, .mobile-brand .name, .brand-lockup .name').forEach(function (el) {
      el.textContent = name;
    });
    if (logo) {
      document.querySelectorAll('.sb-brand svg, .mobile-brand svg, .brand-lockup svg').forEach(function (el) {
        var img = document.createElement('img');
        img.src = logo;
        img.alt = name;
        img.style.cssText = el.getAttribute('style') || '';
        img.className = el.getAttribute('class') || '';
        var w = el.getBoundingClientRect().width || 30;
        img.style.width = w + 'px';
        img.style.height = w + 'px';
        img.style.objectFit = 'cover';
        img.style.borderRadius = '50%';
        el.replaceWith(img);
      });
    }
    var branchEls = document.querySelectorAll('.sb-branch');
    branchEls.forEach(function (el) {
      var dot = el.querySelector('.dot');
      el.textContent = '';
      if (dot) el.appendChild(dot);
      el.appendChild(document.createTextNode(' ' + (settings.branch_name || 'الفرع') + ' — متصل'));
    });
  }

  var currentUser = null;
  async function requireAuth() {
    try {
      currentUser = await api('/api/auth/me');
      await getSettings();
      applyRolePermissions(currentUser);
      showLicenseBanner();
      return currentUser;
    } catch (e) {
      window.location.href = 'login.html';
      throw e;
    }
  }

  function isOwner() {
    return !!currentUser && currentUser.role === 'owner';
  }

  // 'reports' is always owner-only and is never part of the configurable permissions list.
  function hasPerm(mod) {
    if (!currentUser) return false;
    if (currentUser.role === 'owner') return true;
    if (mod === 'reports' || mod === 'finance') return false;
    if (currentUser.permissions === null || currentUser.permissions === undefined) return true;
    return currentUser.permissions.indexOf(mod) !== -1;
  }

  var PAGE_MODULES = {
    'pos.html': 'pos',
    'bookings.html': 'bookings',
    'inventory.html': 'inventory',
    'customers.html': 'customers',
    'reports.html': 'reports',
    'finance.html': 'finance'
  };

  function applyRolePermissions(user) {
    if (user.role === 'owner') return;

    Object.keys(PAGE_MODULES).forEach(function (page) {
      var mod = PAGE_MODULES[page];
      if (!hasPerm(mod)) {
        document.querySelectorAll('a[href="' + page + '"]').forEach(function (el) {
          el.classList.add('disabled');
          el.removeAttribute('href');
          el.setAttribute('title', 'ليست لديكِ صلاحية للوصول لهذا القسم');
        });
      }
    });

    var currentPage = location.pathname.split('/').pop();
    var currentMod = PAGE_MODULES[currentPage];
    if (currentMod && !hasPerm(currentMod)) {
      window.location.href = 'dashboard.html';
    }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    window.location.href = 'login.html';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initials(name) {
    var p = (name || '').trim().split(' ');
    return (p[0] ? p[0][0] : '') + (p[1] ? p[1][0] : '');
  }

  function relTime(iso) {
    if (!iso) return '—';
    var then = new Date(iso.replace(' ', 'T') + 'Z');
    var diffMs = Date.now() - then.getTime();
    var days = Math.floor(diffMs / 86400000);
    if (days <= 0) return 'اليوم';
    if (days === 1) return 'قبل يوم';
    if (days < 7) return 'قبل ' + days + ' أيام';
    if (days < 30) return 'قبل ' + Math.floor(days / 7) + ' أسابيع';
    return 'قبل ' + Math.floor(days / 30) + ' شهر';
  }

  /* ---------------- Image helpers ---------------- */
  function pickAndCompressImage(maxDim) {
    maxDim = maxDim || 800;
    return new Promise(function (resolve, reject) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return reject(new Error('لم يتم اختيار ملف'));
        var reader = new FileReader();
        reader.onload = function () {
          var img = new Image();
          img.onload = function () {
            var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            var c = canvas.getContext('2d');
            c.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          };
          img.onerror = reject;
          img.src = reader.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      input.click();
    });
  }

  async function uploadImage(maxDim) {
    var dataUrl = await pickAndCompressImage(maxDim);
    var res = await api('/api/upload', { method: 'POST', body: { dataUrl: dataUrl } });
    return res.url;
  }

  /* ---------------- Print helpers ----------------
     openPrintWindow() must be called synchronously inside the click handler
     (before any await) so the browser still counts it as user-gesture-triggered
     and doesn't block it as a popup. printHTML() then fills that window later. */
  function openPrintWindow() {
    return window.open('', '_blank');
  }

  function printHTML(bodyHtml, pageStyle, win) {
    win = win || window.open('', '_blank');
    if (!win) {
      alert('تم حظر نافذة الطباعة من المتصفح — يرجى السماح بالنوافذ المنبثقة لهذا الموقع ثم إعادة المحاولة');
      return;
    }
    var baseStyle = '*{box-sizing:border-box;} html,body{margin:0;} img{max-width:100%;}';
    win.document.write(
      '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">' +
      '<style>' + baseStyle + pageStyle + '</style></head><body>' + bodyHtml + '</body></html>'
    );
    win.document.close();
    win.focus();
    setTimeout(function () { win.print(); }, 300);
  }

  /* Sidebar scrolls on short screens and its footer (user + logout) stays pinned and visible. */
  (function () {
    var st = document.createElement('style');
    st.textContent =
      '.sidebar{overflow-y:auto;}' +
      '.sidebar .sb-footer{position:sticky;bottom:0;background:var(--color-surface);z-index:2;padding-bottom:4px;flex:none;}';
    document.head.appendChild(st);
  })();


  /* ---------------- Brand icons (favicon / web-app icon / Windows shortcut), always circular ---------------- */
  function brandVersion() { try { return localStorage.getItem('bh_brand_v') || '1'; } catch (e) { return '1'; } }
  function applyBrandIcons() {
    var v = brandVersion();
    function setLink(rel, href, extra) {
      var el = document.querySelector('link[rel="' + rel + '"]' + (extra && extra.sizes ? '[sizes="' + extra.sizes + '"]' : ''));
      if (!el) { el = document.createElement('link'); el.rel = rel; if (extra && extra.sizes) el.setAttribute('sizes', extra.sizes); document.head.appendChild(el); }
      if (extra && extra.type) el.type = extra.type;
      el.href = href;
    }
    setLink('icon', '/branding/icon-64.png?v=' + v, { type: 'image/png' });
    setLink('apple-touch-icon', '/branding/icon-192.png?v=' + v);
    setLink('manifest', '/manifest.webmanifest?v=' + v);
    if (!document.querySelector('meta[name="theme-color"]')) {
      var m = document.createElement('meta'); m.name = 'theme-color'; m.content = '#6E2A55'; document.head.appendChild(m);
    }
  }
  applyBrandIcons();

  function circularPng(img, size) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    var x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.beginPath(); x.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); x.closePath(); x.clip();
    var sc = Math.max(size / img.naturalWidth, size / img.naturalHeight);
    var w = img.naturalWidth * sc, h = img.naturalHeight * sc;
    x.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return c.toDataURL('image/png');
  }

  // Build circular PNG icons from the uploaded logo and let the server turn them into the .ico used by shortcuts.
  async function syncBrandIcons(logoUrl) {
    if (!logoUrl) {
      await api('/api/branding/icon', { method: 'POST', body: { reset: true } });
    } else {
      var img = await new Promise(function (resolve, reject) {
        var i = new Image(); i.onload = function () { resolve(i); }; i.onerror = reject; i.src = logoUrl + (logoUrl.indexOf('?') === -1 ? '?' : '&') + 'x=' + Date.now();
      });
      var icons = {};
      [16, 32, 48, 64, 128, 192, 256, 512].forEach(function (sz) { icons[sz] = circularPng(img, sz); });
      await api('/api/branding/icon', { method: 'POST', body: { icons: icons } });
    }
    try { localStorage.setItem('bh_brand_v', String(Date.now())); } catch (e) { /* ignore */ }
    applyBrandIcons();
  }

  /* ---------------- License banner (trial / expiring) ---------------- */
  async function showLicenseBanner() {
    try {
      var main = document.querySelector('.main');
      if (!main || document.getElementById('licBanner')) return;
      var s = await api('/api/license/status');
      var msg = null, bad = false;
      if (s.state === 'trial') msg = 'نسخة تجريبية — متبقي ' + s.days_left + ' يوماً. فعّلي النظام للاستمرار دون انقطاع.';
      else if (s.state === 'licensed' && s.expires && s.days_left <= 14) { msg = 'ينتهي ترخيص النظام خلال ' + s.days_left + ' يوماً (' + s.expires + ') — تواصلي مع مزوّد النظام للتجديد.'; bad = s.days_left <= 3; }
      if (!msg) return;
      var b = document.createElement('div');
      b.id = 'licBanner';
      b.style.cssText = 'display:flex;align-items:center;gap:12px;justify-content:center;flex:none;padding:8px 16px;font-size:12.5px;font-weight:700;' +
        'background:' + (bad ? 'var(--color-danger-tint)' : 'var(--color-warning-tint)') + ';color:' + (bad ? 'var(--color-danger)' : 'var(--color-warning)') + ';border-bottom:1px solid var(--color-border);';
      b.innerHTML = '<span>' + esc(msg) + '</span><a href="activate.html" style="color:inherit;text-decoration:underline;white-space:nowrap;">إدارة الترخيص</a>';
      main.insertBefore(b, main.firstChild);
    } catch (e) { /* never block the page */ }
  }

  /* ---------------- Finance nav link + payment helpers ---------------- */
  var PAY_LABELS = { cash: 'نقداً', bankak: 'بنكك', ocash: 'أوكاش', split: 'مقسّم' };
  function payLabel(m) { return PAY_LABELS[m] || m || '—'; }

  function ensureFinanceNav() {
    if (document.querySelector('[data-nav="finance"]')) return;
    var items = document.querySelectorAll('.sidebar nav .nav-item');
    var anchor = null;
    items.forEach(function (el) { if (el.textContent.indexOf('التقارير') !== -1) anchor = el; });
    if (!anchor) return;
    var a = document.createElement('a');
    a.className = 'nav-item';
    a.setAttribute('data-nav', 'finance');
    a.href = 'finance.html';
    a.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.8"/><path d="M6 9.5v.01M18 15.5v.01"/></svg> المالية';
    anchor.parentNode.insertBefore(a, anchor.nextSibling);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureFinanceNav);
  else ensureFinanceNav();

  function round2(n) { return Math.round(Number(n) * 100) / 100; }

  /* Split-payment dialog. opts: { total, initial: [{method, amount}] }. Resolves to a list or null (cancelled). */
  function splitPaymentDialog(opts) {
    return new Promise(function (resolve) {
      var total = round2(opts.total);
      var s = settingsCache || {};
      var methods = ['cash', 'bankak', 'ocash'].filter(function (m) { return s['pay_' + m] !== '0'; });
      var initial = {};
      (opts.initial || []).forEach(function (p) { initial[p.method] = p.amount; });

      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(20,16,31,.55);z-index:100;display:flex;align-items:center;justify-content:center;padding:20px;';
      var rows = methods.map(function (m) {
        return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">' +
          '<div style="width:70px;font-weight:700;font-size:13.5px;">' + payLabel(m) + '</div>' +
          '<input type="number" min="0" step="any" data-m="' + m + '" value="' + (initial[m] || '') + '" placeholder="0" style="flex:1;direction:ltr;text-align:right;font-family:var(--font-mono);font-size:14px;padding:9px 12px;border:1px solid var(--color-border-strong);border-radius:6px;background:var(--color-surface);color:var(--color-text);" />' +
          '<button type="button" data-fill="' + m + '" style="border:1px solid var(--color-border-strong);background:var(--color-surface-2);color:var(--color-text-secondary);border-radius:6px;padding:8px 10px;font-size:11.5px;font-weight:600;cursor:pointer;">الباقي</button>' +
          '</div>';
      }).join('');
      overlay.innerHTML =
        '<div style="width:100%;max-width:400px;background:var(--color-surface);color:var(--color-text);border-radius:16px;box-shadow:var(--shadow-lg);padding:22px;font-family:var(--font-body);">' +
        '<h3 style="margin:0 0 4px;font-size:16px;">تقسيم الدفع على عدة وسائل</h3>' +
        '<p style="margin:0 0 16px;font-size:12.5px;color:var(--color-text-secondary);">الإجمالي المطلوب: <b style="font-family:var(--font-mono);">' + money(total) + '</b></p>' +
        rows +
        '<div id="spStatus" style="margin:6px 0 16px;padding:10px 12px;border-radius:8px;font-size:13px;font-weight:600;"></div>' +
        '<div style="display:flex;gap:10px;">' +
        '<button type="button" id="spCancel" style="flex:1;padding:10px;border-radius:6px;border:1px solid var(--color-border-strong);background:transparent;color:var(--color-text);font-weight:600;cursor:pointer;font-family:inherit;">إلغاء</button>' +
        '<button type="button" id="spOk" style="flex:1;padding:10px;border-radius:6px;border:none;background:var(--color-accent);color:var(--color-on-accent);font-weight:700;cursor:pointer;font-family:inherit;">تأكيد</button>' +
        '</div></div>';
      document.body.appendChild(overlay);

      var inputs = overlay.querySelectorAll('input[data-m]');
      var status = overlay.querySelector('#spStatus');
      var ok = overlay.querySelector('#spOk');
      function paid() {
        var sum = 0;
        inputs.forEach(function (i) { sum += Number(i.value) || 0; });
        return round2(sum);
      }
      function refresh() {
        var rem = round2(total - paid());
        var good = Math.abs(rem) < 0.01 && paid() > 0;
        status.style.background = good ? 'var(--color-success-tint)' : 'var(--color-warning-tint)';
        status.style.color = good ? 'var(--color-success)' : 'var(--color-warning)';
        status.textContent = good ? 'المبلغ مكتمل' : (rem > 0 ? 'المتبقي: ' + money(rem) : 'زيادة عن الإجمالي بمقدار ' + money(-rem));
        ok.disabled = !good;
        ok.style.opacity = good ? '1' : '.5';
        ok.style.cursor = good ? 'pointer' : 'not-allowed';
      }
      function close(val) { overlay.remove(); resolve(val); }
      inputs.forEach(function (i) { i.addEventListener('input', refresh); });
      overlay.querySelectorAll('[data-fill]').forEach(function (b) {
        b.addEventListener('click', function () {
          var m = b.getAttribute('data-fill');
          var inp = overlay.querySelector('input[data-m="' + m + '"]');
          var others = 0;
          inputs.forEach(function (i) { if (i !== inp) others += Number(i.value) || 0; });
          var rest = round2(total - others);
          inp.value = rest > 0 ? rest : '';
          refresh();
        });
      });
      overlay.querySelector('#spCancel').addEventListener('click', function () { close(null); });
      overlay.addEventListener('click', function (e) { if (e.target === overlay) close(null); });
      ok.addEventListener('click', function () {
        if (ok.disabled) return;
        var list = [];
        inputs.forEach(function (i) {
          var a = round2(i.value);
          if (a > 0) list.push({ method: i.getAttribute('data-m'), amount: a });
        });
        close(list);
      });
      refresh();
      if (inputs[0]) inputs[0].focus();
    });
  }

  /* Keep the logout button in the sidebar footer on every page (dashboard has its own). */
  function ensureLogoutButton() {
    var footer = document.querySelector('.sb-footer');
    if (!footer || document.getElementById('logoutBtn')) return;
    var btn = document.createElement('button');
    btn.className = 'icon-btn';
    btn.id = 'logoutBtn';
    btn.type = 'button';
    btn.title = 'تسجيل الخروج';
    btn.setAttribute('aria-label', 'تسجيل الخروج');
    btn.style.marginInlineStart = 'auto';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H3"/></svg>';
    btn.addEventListener('click', function () { logout(); });
    footer.appendChild(btn);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureLogoutButton);
  else ensureLogoutButton();

  return {
    api: api,
    getSettings: getSettings,
    money: money,
    esc: esc,
    syncBrandIcons: syncBrandIcons,
    applyBrandIcons: applyBrandIcons,
    payLabel: payLabel,
    PAY_LABELS: PAY_LABELS,
    splitPaymentDialog: splitPaymentDialog,
    requireAuth: requireAuth,
    isOwner: isOwner,
    hasPerm: hasPerm,
    logout: logout,
    initials: initials,
    relTime: relTime,
    applyBranding: applyBranding,
    initThemeToggle: initThemeToggle,
    showAbout: showAbout,
    setTheme: setTheme,
    currentTheme: currentTheme,
    startClock: startClock,
    uploadImage: uploadImage,
    printHTML: printHTML,
    openPrintWindow: openPrintWindow,
    get user() { return currentUser; }
  };
})();
