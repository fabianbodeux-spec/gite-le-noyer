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
      const response=await fetch('/api/admin/'+path,{signal:controller.signal,method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
      if(response.status===401)throw Error('Clé refusée. Utilisez la clé affichée dans le Terminal pour '+location.host+'. Copiez uniquement la clé, sans le libellé.');
      if(response.status===404)throw Error('Le serveur actif utilise une ancienne version. Arrêtez-le avec Ctrl+C, relancez python3 ~/le-noyer-v6/demarrer.py puis rechargez cette page.');
      const result=await response.json();if(!response.ok)throw Error(result.error || 'Réessayez.');return result;
    } catch(error) {
      if(error.name==='AbortError')throw Error('Le serveur ne répond pas. Vérifiez le Terminal et l’adresse de gestion affichée au démarrage.');
      if(error instanceof TypeError)throw Error('Serveur inaccessible. Relancez le site puis utilisez exactement l’adresse Gestion affichée dans Terminal.');
      throw error;
    } finally {clearTimeout(timeout)}
  }
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
    if(current!==generation || !token)return;
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
  element('login').addEventListener('submit',async event=>{
    event.preventDefault();
    const trigger=event.currentTarget.querySelector('button');trigger.disabled=true;
    announce('Connexion au backend…');
    token=element('admin-token').value.trim().replace(/^Cl[ée]\s+propri[ée]taire\s*:\s*/i,'').trim();
    try {
      if(!window.NoyerWorkspace)throw Error('Le module de gestion n’a pas chargé. Arrêtez le serveur avec Ctrl+C, relancez python3 ~/le-noyer-v6/demarrer.py puis rechargez la page.');
      if(!workspaceReady){window.NoyerWorkspace.connect(api,refresh);workspaceReady=true}
      await refresh();element('admin-token').value='';element('page-title').focus({preventScroll:true});
    }catch(error){token='';announce(error.message)}
    finally{trigger.disabled=false}
  });
  element('logout').addEventListener('click',()=>{window.NoyerWorkspace?.clear();token='';generation++;element('management').hidden=true;element('auth-shell').hidden=false;element('login').hidden=false;['rates','blocks','requests-platforms','requests-site','reception-list','cleaning-list','metrics','admin-calendar'].forEach(id=>element(id).replaceChildren());announce('Gestion fermée.')});
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
        if(endpoint==='rates')resetRate();
        else {year.value=data.start.slice(0,4);updateSelection()}
        element(statusId).textContent=endpoint==='blocks'?'Indisponibilité enregistrée du '+localDate(data.start)+' au '+localDate(data.end)+'. Ces nuits sont maintenant bloquées sur le site.':'Tarif enregistré.';
        await refresh();
      }
      catch(error){element(statusId).textContent=error.message}
      finally{button.disabled=false}
    });
  });
})();
