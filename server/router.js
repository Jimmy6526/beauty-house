const routes = [];

function pathToRegex(path) {
  const paramNames = [];
  const pattern = path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        paramNames.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp('^' + pattern + '$'), paramNames };
}

function add(method, path, handler, opts) {
  const { regex, paramNames } = pathToRegex(path);
  routes.push({ method, regex, paramNames, handler, auth: !opts || opts.auth !== false, role: opts && opts.role, perm: opts && opts.perm });
}

function match(method, pathname) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.regex.exec(pathname);
    if (m) {
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params, auth: r.auth, role: r.role, perm: r.perm };
    }
  }
  return null;
}

module.exports = {
  get: (path, handler, opts) => add('GET', path, handler, opts),
  post: (path, handler, opts) => add('POST', path, handler, opts),
  put: (path, handler, opts) => add('PUT', path, handler, opts),
  del: (path, handler, opts) => add('DELETE', path, handler, opts),
  match
};
