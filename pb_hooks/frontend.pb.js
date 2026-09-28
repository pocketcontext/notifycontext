/// <reference path="../pb_data/types.d.ts" />
// Application-owned static client. Run the server from the app directory.
// API routes remain more specific; only generated public assets are served.
routerAdd('GET', '/{path...}', $apis.static('pb_public', false), (e) => {
  e.response.header().set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  e.response.header().set('X-Content-Type-Options', 'nosniff');
  e.response.header().set('Referrer-Policy', 'no-referrer');
  return e.next();
});
