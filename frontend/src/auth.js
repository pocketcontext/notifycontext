import PocketBase, {BaseAuthStore, LocalAuthStore} from 'pocketbase';

export const pb = new PocketBase(location.origin, new LocalAuthStore('notifycontext.auth'));
pb.autoCancellation(false);
if (!pb.authStore.isValid || pb.authStore.record?.collectionName !== 'users') pb.authStore.clear();
let generation = 0;
export const sessionIdentity = () => pb.authStore.isValid && pb.authStore.record?.collectionName === 'users' ? pb.authStore.record.id : '';
let activeIdentity = sessionIdentity();
let refreshedAt = 0, refreshedToken = '';
let refreshing;
pb.authStore.onChange(() => {
  const next = sessionIdentity();
  if (next === activeIdentity) {
    // Adopt another tab's renewal without scheduling a renewal ping-pong.
    if (next) { refreshedAt = Date.now(); refreshedToken = pb.authStore.token; }
    return;
  }
  activeIdentity = next;
  generation++;
  void pb.realtime.unsubscribe().catch(() => {});
});
// Reject late reads AND writes before any caller can use their returned data.
const send = pb.send.bind(pb);
pb.send = async (path, options) => {
  const started = generation, token = pb.authStore.token, identity = sessionIdentity();
  try {
    const result = await send(path, options);
    if (started !== generation || identity !== sessionIdentity()) throw new Error('Session changed');
    return result;
  } catch (error) {
    if (started === generation && token === pb.authStore.token && token && [401,403].includes(error.status)) {
      pb.authStore.clear();
      throw new Error(error.status === 401 ? 'Your session ended. Sign in again to continue.' : 'Your access changed. Sign in again to continue.');
    }
    throw error;
  }
};
export async function signIn(email, password, google = false) {
  const started = generation, token = pb.authStore.token;
  const client = new PocketBase(location.origin, new BaseAuthStore());
  try {
    const auth = client.collection('users');
    const result = google ? await auth.authWithOAuth2({provider:'google'}) : await auth.authWithPassword(email,password);
    if (started !== generation || token !== pb.authStore.token) throw new Error('Session changed');
    if (result.record.collectionName !== 'users') throw new Error('Invalid workspace identity');
    refreshedAt = Date.now(); refreshedToken = result.token;
    pb.authStore.save(result.token,result.record);
  } finally { await client.realtime.unsubscribe(); }
}
export async function refreshSession() {
  if (!pb.authStore.isValid) { if (pb.authStore.token) pb.authStore.clear(); return; }
  const started = generation, token = pb.authStore.token;
  if (refreshing?.token === token && refreshing.generation === started) return refreshing.promise;
  if (token === refreshedToken && Date.now()-refreshedAt < 300000) return;
  const client = new PocketBase(location.origin, new BaseAuthStore());
  client.authStore.save(token,pb.authStore.record);
  refreshedAt = Date.now(); refreshedToken = token;
  const pending = {token,generation:started,promise:null};
  pending.promise = client.collection('users').authRefresh().then(result => {
    if (started === generation && token === pb.authStore.token) {
      if (result.record.collectionName !== 'users') { pb.authStore.clear(); return; }
      refreshedAt = Date.now(); refreshedToken = result.token;
      pb.authStore.save(result.token,result.record);
    }
  }).catch(error => {
    if (started === generation && token === pb.authStore.token && [401,403].includes(error.status)) pb.authStore.clear();
  }).finally(() => { if(refreshing === pending) refreshing = undefined; });
  refreshing = pending;
  return pending.promise;
}
