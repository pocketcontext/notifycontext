import {escapeHTML as e, markdown} from './core.js';

// The textarea remains the form control in both tabs. State is owned by the caller
// so detail refreshes can replace the DOM without replacing the draft or editor view.
export function editorMarkup({id,label,name='',value='',rows=3,maxlength=4000,required=false,disabled=false,placeholder='',previewId=`${id}-preview`}) {
  return `<div class="markdown-editor" data-editor-id="${e(id)}"><label for="${e(id)}">${e(label)} <span class="optional">Markdown supported</span></label><div class="markdown-editor-surface"><div class="markdown-tabs" role="tablist" aria-label="${e(label)} editor"><button type="button" role="tab" id="${e(id)}-write-tab" aria-controls="${e(id)}-write-panel" aria-selected="true">Write</button><button type="button" role="tab" id="${e(id)}-preview-tab" aria-controls="${e(id)}-preview-panel" aria-selected="false" tabindex="-1">Preview</button></div><div role="tabpanel" id="${e(id)}-write-panel" aria-labelledby="${e(id)}-write-tab"><textarea id="${e(id)}" ${name?`name="${e(name)}"`:''} rows="${rows}" maxlength="${maxlength}" ${required?'required':''} ${disabled?'disabled':''} placeholder="${e(placeholder)}">${e(value)}</textarea></div><div role="tabpanel" id="${e(id)}-preview-panel" aria-labelledby="${e(id)}-preview-tab" tabindex="0" hidden><div id="${e(previewId)}" class="markdown markdown-preview"></div></div></div></div>`;
}

export function captureEditors(container) {
  for (const editor of container.querySelectorAll('.markdown-editor')) editor.captureMarkdownEditor?.();
}

export function bindEditor(id,state={},onInput=()=>{}) {
  const textarea=document.getElementById(id),root=textarea.closest('.markdown-editor');
  const write=root.querySelector(`#${id}-write-panel`),preview=root.querySelector(`#${id}-preview-panel`),rendered=preview.querySelector('.markdown-preview');
  const tabs=[...root.querySelectorAll('[role=tab]')];
  const capture=()=>{
    if(!root.isConnected)return;
    state.start=textarea.selectionStart;state.end=textarea.selectionEnd;state.direction=textarea.selectionDirection;
    if(!write.hidden){state.scrollTop=textarea.scrollTop;if(textarea.getBoundingClientRect().height)state.height=textarea.getBoundingClientRect().height;}
    if(!preview.hidden)state.previewScroll=preview.scrollTop;
    state.focus=root.contains(document.activeElement)?document.activeElement.id:null;
  };
  root.captureMarkdownEditor=capture;
  const render=()=>{rendered.innerHTML=textarea.value.trim()?markdown(textarea.value):'<p class="markdown-empty">Nothing to preview yet.</p>';};
  const select=(tab,{focus=false,restoreCursor=false}={})=>{
    const next=tab==='preview'?'preview':'write';
    capture();
    state.tab=next;write.hidden=next!=='write';preview.hidden=next!=='preview';
    for(const [index,button] of tabs.entries()){
      const active=(index===1)===(next==='preview');button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
    }
    if(state.height){textarea.style.height=`${state.height}px`;preview.style.height=`${state.height}px`;}
    if(next==='preview'){render();preview.scrollTop=state.previewScroll||0;}
    else textarea.scrollTop=state.scrollTop||0;
    if(next==='write' && restoreCursor){textarea.focus({preventScroll:true});textarea.setSelectionRange(state.start??textarea.value.length,state.end??textarea.value.length,state.direction||'none');textarea.scrollTop=state.scrollTop||0;}
    if(focus)tabs[next==='preview'?1:0].focus({preventScroll:true});
  };
  if(state.height)textarea.style.height=`${state.height}px`;
  // Restore the saved selection before select() captures the newly created textarea.
  textarea.setSelectionRange(state.start??textarea.value.length,state.end??textarea.value.length,state.direction||'none');textarea.scrollTop=state.scrollTop||0;
  const savedTab=state.tab,savedFocus=state.focus;
  select(savedTab);
  tabs.forEach((button,index)=>{
    button.onclick=()=>select(index?'preview':'write',{focus:true});
    button.onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?1:1-index;select(next?'preview':'write',{focus:true});
    };
  });
  textarea.addEventListener('input',()=>{onInput(textarea.value);capture();if(state.tab==='preview')render();});
  textarea.addEventListener('select',capture);
  textarea.addEventListener('blur',capture);
  // Browsers validate before submit. Reveal the required control synchronously so
  // preview submissions retain native validation instead of hitting a hidden field.
  textarea.addEventListener('invalid',()=>select('write',{restoreCursor:true}));
  if(savedFocus && root.querySelector(`#${savedFocus}`)){
    const target=document.getElementById(savedFocus);
    if(!target.disabled && !target.closest('[hidden]'))target.focus({preventScroll:true});
  }
  return {capture,select};
}
