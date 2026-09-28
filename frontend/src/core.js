import {marked} from 'marked';
import DOMPurify from 'dompurify';
export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const sqlQuote = value => "'" + String(value).replaceAll("'", "''") + "'";
export function markdown(text) {
  // Remote images can leak private content viewing; raw HTML is never interpreted.
  const renderer = new marked.Renderer();
  renderer.html = ({text}) => escapeHTML(text);
  renderer.image = ({text}) => escapeHTML(text || '[image]');
  return DOMPurify.sanitize(marked.parse(text || '', {renderer, gfm:true}), {FORBID_TAGS:['img','style','form','input','button','iframe'], FORBID_ATTR:['style']});
}
export function rows(result) {
  if (result.truncated) throw new Error('The result was incomplete. Narrow your search and try again.');
  return result.rows.map(row=>Object.fromEntries(result.columns.map((col,i)=>[col,row[i]])));
}
export const statusLabel = value => ({available:'Available',busy:'Busy',in_a_meeting:'In a meeting',away:'Away',not_set:'Not set'}[value] || 'Not set');
export const kindLabel = value => ({fyi:'FYI',review_requested:'Review requested',action_required:'Action required'}[value] || value);
export function effectiveStatus(status, now=Date.now()) {
  if (!status || (status.expires_at && new Date(status.expires_at.replace(' ','T')).getTime() <= now)) return 'not_set';
  return status.availability;
}
export function alertDecision({latest, previous, paused, permission, missed}) {
  if (!previous || paused || permission !== 'granted' || !latest.length) return null;
  return missed || latest.length > 1 ? {title:`${latest.length} new notifications`,body:'Open your inbox to catch up.'} : {title:'New notification',body:'Open NotifyContext to view your notification.'};
}
