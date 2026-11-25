(() => {
  const element = id => document.getElementById(id);
  const money = cents => cents === null ? 'Sans devis' : new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR'}).format(cents/100);
  const year = element('year');year.value=new Date().getFullYear();
  let token = '';
  let generation = 0;
  let workspaceReady = false;
  const blockForm = element('block-form');
  const blockStart = element('block-start');
  const blockEnd = element('block-end');
  const localDate = value => new Intl.DateTimeFormat('fr-BE', {dateStyle:'long'}).format(new Date(value+'T12:00:00'));
  function announce(message) {element(element('management').hidden?'admin-status':'erp-status').textContent=message}
  const now = new Date();
  const today = now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  blockStart.min = today;
  blockEnd.min = today;
  function updateSelection() {
    blockEnd.setCustomValidity('');
    if (blockStart.value) {
      const next = new Date(blockStart.value+'T12:00:00');
      next.setDate(next.getDate()+1);
      blockEnd.min = next.getFullYear()+'-'+String(next.getMonth()+1).padStart(2,'0')+'-'+String(next.getDate()).padStart(2,'0');
      if (blockEnd.value && blockEnd.value <= blockStart.value) blockEnd.setCustomValidity('Le départ doit être après l’arrivée.');
    } else blockEnd.min=today;
    document.querySelectorAll('#admin-calendar button[data-date]').forEach(button=>{
      const selected = Boolean(blockStart.value && (blockEnd.value ? button.dataset.date>=blockStart.value && button.dataset.date<blockEnd.value : button.dataset.date===blockStart.value));
      button.dataset.selected=String(selected);
      button.setAttribute('aria-pressed',String(selected));
    });
  }
  function selectDate(value) {
    if (!blockStart.value || blockEnd.value || value<=blockStart.value) {
      blockStart.value=value;blockEnd.value='';
      element('block-status').textContent='Arrivée : '+localDate(value)+'. Cliquez maintenant sur la date de départ.';
    } else {
      blockEnd.value=value;
      element('block-status').textContent='Du '+localDate(blockStart.value)+' au '+localDate(value)+'. Choisissez le motif puis cliquez sur « Enregistrer l’indisponibilité ».';
      blockForm.scrollIntoView({block:'center'});
      element('block-reason').focus({preventScroll:true});
    }
    updateSelection();
  }
  blockStart.addEventListener('input',updateSelection);
  blockEnd.addEventListener('input',updateSelection);
  element('clear-block').addEventListener('click',()=>{blockForm.reset();updateSelection();element('block-status').textContent='Sélection effacée. Choisissez une arrivée et un départ.'});
  async function api(path, data) {
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),30000);
    try {
      const response=await fetch('/api/admin/'+path,{signal:controller.signal,method:data?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
      if(response.status===401)throw Error(token?'Clé de secours refusée. Copiez uniquement la clé, sans le libellé.':'Connexion expirée ou refusée. Reconnectez-vous avec votre prénom et votre code.');
      const payload=await response.text();let result={};
      try{result=payload?JSON.parse(payload):{}}catch{if(!response.ok)throw Error('Le serveur a répondu HTTP '+response.status+' sans message exploitable. Consultez les journaux Railway.');throw Error('Réponse du serveur illisible. Actualisez la page et consultez les journaux Railway.')}
      if(!response.ok)throw Error(result.error || 'Erreur serveur HTTP '+response.status+'. Consultez les journaux Railway.');return result;
    } catch(error) {
      if(error.name==='AbortError')throw Error('Le serveur ne répond pas. Vérifiez le Terminal et l’adresse de gestion affichée au démarrage.');
      if(error instanceof TypeError)throw Error('Serveur inaccessible. Relancez le site puis utilisez exactement l’adresse Gestion affichée dans Terminal.');
      throw error;
    } finally {clearTimeout(timeout)}
  }
  // Sauvegarde complète de la base, téléchargée avec la clé propriétaire.
  element('download-backup')?.addEventListener('click',async event=>{
    const trigger=event.currentTarget;trigger.disabled=true;
    try{
      const response=await fetch('/api/admin/backup',{headers:token?{Authorization:'Bearer '+token}:{}});
      if(!response.ok)throw Error(response.status===401?'Clé refusée : reconnectez-vous.':'Sauvegarde impossible (HTTP '+response.status+').');
      const blob=await response.blob();const link=document.createElement('a');
      link.href=URL.createObjectURL(blob);link.download='le-noyer-sauvegarde-'+today+'.sqlite3';
      document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),2000);
      announce('Sauvegarde téléchargée : conservez ce fichier en lieu sûr.');
    }catch(error){announce(error.message)}finally{trigger.disabled=false}
  });
  function text(parent, tag, content) {const node=document.createElement(tag);node.textContent=content;parent.append(node);return node}
  function action(parent, label, callback) {
    const button=text(parent,'button',label);button.type='button';
    button.addEventListener('click',async()=>{button.disabled=true;try{await callback()}catch(error){announce(error.message)}finally{button.disabled=false}});
  }
  function record(parent, heading, description) {const node=document.createElement('article');node.className='admin-record';text(node,'h3',heading);text(node,'p',description);parent.append(node);const actions=document.createElement('div');actions.className='record-actions';node.append(actions);return actions}
  async function refresh() {
    if(!year.reportValidity())return;
    const current=++generation;
    const [state,workspace]=await Promise.all([api('state?year='+year.value),api('workspace?year='+year.value)]);
    if(current!==generation || (!token && !window.NoyerAccount))return;
    element('management').hidden=false;element('login').hidden=true;element('auth-shell').hidden=true;
    announce('Données actualisées. Le prévisionnel concerne les demandes directes du site, pas les réservations externes.');
    element('metrics').replaceChildren();
    [[money(state.forecast_cents),'Prévisionnel des réservations directes'],[state.confirmed_nights,'Nuits occupées'],[state.unpriced_nights,'Dates tarifaires à compléter']].forEach(([value,label])=>{const box=document.createElement('div');text(box,'strong',value);text(box,'span',label);element('metrics').append(box)});
    element('admin-calendar').replaceChildren();
    for(let month=0;month<12;month++) {
      const section=document.createElement('section');section.className='calendar-month';
      text(section,'h3',new Intl.DateTimeFormat('fr-BE',{month:'long'}).format(new Date(state.year,month,1)));
      const grid=document.createElement('div');grid.className='calendar-grid';
      ['L','M','M','J','V','S','D'].forEach(day=>text(grid,'span',day).className='calendar-weekday');
      const offset=(new Date(state.year,month,1).getDay()+6)%7;
      for(let count=0;count<offset;count++)grid.append(document.createElement('span'));
      state.days.filter(day=>Number(day.date.slice(5,7))===month+1).forEach(day=>{
        const cell=text(grid,'button',Number(day.date.slice(8)));cell.type='button';cell.className='calendar-day';cell.dataset.state=day.state;cell.dataset.date=day.date;
        cell.title=localDate(day.date)+' : '+({available:'disponible',occupied:'occupé',unpriced:'tarif manquant'}[day.state])+(day.cents===null?'':(day.package==='midweek'?' / référence mid-week (4 nuits) ':' / tarif week-end fixe ')+money(day.cents));
        cell.setAttribute('aria-label',cell.title+'. Choisir cette date.');cell.disabled=day.date<today;
        cell.addEventListener('click',()=>selectDate(day.date));
      });
      section.append(grid);element('admin-calendar').append(section);
    }
    element('blocks').replaceChildren();
    if(!state.blocks.length)text(element('blocks'),'p','Aucune période bloquée pour cette année.');
    state.blocks.forEach(block=>{const actions=record(element('blocks'),block.reason,localDate(block.start)+' au '+localDate(block.end));action(actions,'Libérer ces dates',async()=>{await api('blocks/'+block.id+'/deactivate',{});await refresh()})});
    updateSelection();
    window.NoyerWorkspace.render(workspace,state);
  }
  async function openManagement(){
    if(!window.NoyerWorkspace)throw Error('Le module de gestion n’a pas chargé. Rechargez la page.');
    if(!workspaceReady){window.NoyerWorkspace.connect(api,refresh);workspaceReady=true}
    await refresh();element('page-title').focus({preventScroll:true});
  }
  element('login').addEventListener('submit',async event=>{
    event.preventDefault();
    const trigger=event.currentTarget.querySelector('button');trigger.disabled=true;
    const secret=element('admin-pin').value.trim().replace(/^Cl[ée]\s+(propri[ée]taire|de secours)\s*:\s*/i,'').trim();
    const useKey=!/^\d{6}$/.test(secret);
    announce('Connexion…');
    try {
      if(useKey){
        if(secret.length<24)throw Error('Entrez votre code à 6 chiffres avec votre prénom, ou la clé propriétaire complète.');
        token=secret;
        window.NoyerAccount=null;
      } else {
        token='';
        if(!element('admin-name').value.trim())throw Error('Indiquez votre prénom avec votre code à 6 chiffres.');
        const response=await fetch('/api/account/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:element('admin-name').value,pin:secret})});
        const member=await response.json();if(!response.ok)throw Error(member.error||'Connexion impossible.');
        if(member.role!=='owner'){await fetch('/api/account/logout',{method:'POST'});location.href='/equipe-menage';return}
        window.NoyerAccount=member;
      }
      await openManagement();element('admin-pin').value='';
    }catch(error){token='';announce(error.message)}
    finally{trigger.disabled=false}
  });

  // Session permanente : l'appareil reste connecté jusqu'à « Fermer la gestion ».
  fetch('/api/account/me').then(response=>response.ok?response.json():null).then(async member=>{
    if(!member)return;
    if(member.role!=='owner'){location.href='/equipe-menage';return}
    window.NoyerAccount=member;try{await openManagement()}catch(error){announce(error.message)}
  }).catch(()=>{});
  element('logout').addEventListener('click',()=>{if(!token)fetch('/api/account/logout',{method:'POST'}).catch(()=>{});window.NoyerAccount=null;window.NoyerWorkspace?.clear();token='';generation++;element('management').hidden=true;element('auth-shell').hidden=false;element('login').hidden=false;['rates','blocks','requests-platforms','requests-site','reception-list','cleaning-list','metrics','admin-calendar'].forEach(id=>element(id).replaceChildren());announce('Gestion fermée.')});
  element('refresh').addEventListener('click',()=>refresh().catch(error=>announce(error.message)));
  year.addEventListener('change',()=>refresh().catch(error=>announce(error.message)));
  function resetRate(){element('rate-form').reset();element('rate-form').elements.namedItem('id').value=0}
  element('new-rate').addEventListener('click',resetRate);
  [['rate-form','rates','rate-status'],['block-form','blocks','block-status']].forEach(([id,endpoint,statusId])=>{
    element(id).addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit],button:not([type])');
      button.disabled=true;
      const data=Object.fromEntries(new FormData(form));
      try{
        await api(endpoint,data);form.reset();
        if(endpoint==='rates'){resetRate();year.value=data.start.slice(0,4)}
        else {year.value=data.start.slice(0,4);updateSelection()}
        element(statusId).textContent=endpoint==='blocks'?'Indisponibilité enregistrée du '+localDate(data.start)+' au '+localDate(data.end)+'. Ces nuits sont maintenant bloquées sur le site.':'Tarif enregistré.';
        await refresh();
      }
      catch(error){element(statusId).textContent=error.message}
      finally{button.disabled=false}
    });
  });
})();
