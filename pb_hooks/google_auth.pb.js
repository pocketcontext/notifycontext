onBootstrap((e) => {
  require(`${__hooks}/google_auth.js`).domain();
  e.next();
});

onRecordAuthWithOAuth2Request((e) => require(`${__hooks}/google_auth.js`).authenticate(e), "users");

// Runs before the OAuth token response, inside the authenticated exchange transaction.
onRecordAuthRequest(e=>require(`${__hooks}/notify.js`).claimAuth(e),'users');
