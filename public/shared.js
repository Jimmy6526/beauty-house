var BH = (function () {
  /* ---------------- Theme (applied immediately to avoid flash) ---------------- */
  var THEME_KEY = 'bh_theme';
  function getStoredTheme() { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } }
  function applyTheme(mode) {
    var root = document.documentElement;
    if (mode === 'light') root.setAttribute('data-theme', 'light');
    else if (mode === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
  }
  (function initThemeEarly() {
    applyTheme(getStoredTheme());
  })();

  function currentTheme() {
    var stored = getStoredTheme();
    if (stored) return stored;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function setTheme(mode) {
    try {
      if (mode) localStorage.setItem(THEME_KEY, mode);
      else localStorage.removeItem(THEME_KEY);
    } catch (e) {}
    applyTheme(mode);
  }

  function themeToggleIcon(mode) {
    if (mode === 'dark') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
  }

  function initThemeToggle(btnId) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    function render() {
      var stored = getStoredTheme();
      var effective = currentTheme();
      btn.innerHTML = themeToggleIcon(effective);
      btn.title = stored ? (stored === 'dark' ? 'الوضع الداكن — اضغطي للتبديل' : 'الوضع الفاتح — اضغطي للتبديل') : 'يتبع النظام — اضغطي للتبديل';
    }
    btn.addEventListener('click', function () {
      var stored = getStoredTheme();
      var next = stored === 'light' ? 'dark' : stored === 'dark' ? null : 'light';
      setTheme(next);
      render();
    });
    render();
  }

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
        img.style.objectFit = 'contain';
        img.style.borderRadius = '8px';
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
    if (mod === 'reports') return false;
    if (currentUser.permissions === null || currentUser.permissions === undefined) return true;
    return currentUser.permissions.indexOf(mod) !== -1;
  }

  var PAGE_MODULES = {
    'pos.html': 'pos',
    'bookings.html': 'bookings',
    'inventory.html': 'inventory',
    'customers.html': 'customers',
    'reports.html': 'reports'
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
    requireAuth: requireAuth,
    isOwner: isOwner,
    hasPerm: hasPerm,
    logout: logout,
    initials: initials,
    relTime: relTime,
    applyBranding: applyBranding,
    initThemeToggle: initThemeToggle,
    setTheme: setTheme,
    currentTheme: currentTheme,
    startClock: startClock,
    uploadImage: uploadImage,
    printHTML: printHTML,
    openPrintWindow: openPrintWindow,
    get user() { return currentUser; }
  };
})();
