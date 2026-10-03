// Pinned tabs show only the favicon; the title retains the exact count.
export function faviconSVG(count) {
  const badge=count>99?'99+':String(count), width=badge.length===1?16:badge.length===2?23:29;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#193e35"/><path d="M7 25V7h4l10 13V7h4v18h-4L11 12v13z" fill="#fff"/>${count>0?`<rect x="${32-width}" y="15" width="${width}" height="17" rx="3" fill="#fff"/><text x="${32-width/2}" y="29" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="${badge.length>2?14:17}" fill="#102b24">${badge}</text>`:''}</svg>`;
}
let previous;
export function updateTabIndicator(value) {
  const count=Math.max(0,Math.floor(Number(value)||0));
  if(count===previous)return;
  previous=count;
  document.title=count?`(${count}) NotifyContext`:'NotifyContext';
  let icon=document.querySelector('link[rel="icon"]');
  if(!icon){icon=document.createElement('link');icon.rel='icon';document.head.append(icon);}
  icon.type='image/svg+xml';icon.sizes='any';
  icon.href=`data:image/svg+xml,${encodeURIComponent(faviconSVG(count))}`;
}
