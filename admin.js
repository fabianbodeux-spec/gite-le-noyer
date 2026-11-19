(() => {
  const element = id => document.getElementById(id);
  const money = cents => cents === null ? 'Sans devis' : new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR'}).format(cents/100);
  const year = element('year');year.value=new Date().getFullYear();
  let token = '';
  let generation = 0;
  const blockForm = element('block-form');
  const blockStart = element('block-start');
  const blockEnd = element('block-end');
  const localDate = value => new Intl.DateTimeFormat('fr-BE', {dateStyle:'long'}).format(new Date(value+'T12:00:00'));
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
    const response=await fetch('/api/admin/'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const result=await response.json();if(!response.ok)throw Error(result.error || 'Réessayez.');return result;
  }
  function text(parent, tag, content) {const node=document.createElement(tag);node.textContent=content;parent.append(node);return node}
  function action(parent, label, callback) {
    const button=text(parent,'button',label);button.type='button';
    button.addEventListener('click',async()=>{button.disabled=true;try{await callback()}catch(error){element('admin-status').textContent=error.message}finally{button.disabled=false}});
  }
  function record(parent, heading, description) {const node=document.createElement('article');node.className='admin-record';text(node,'h3',heading);text(node,'p',description);parent.append(node);const actions=document.createElement('div');actions.className='record-actions';node.append(actions);return actions}
  async function refresh() {
    if(!year.reportValidity())return;
    const current=++generation;
    const state=await api('state?year='+year.value);
    if(current!==generation || !token)return;
    element('management').hidden=false;element('login').hidden=true;
    element('admin-status').textContent='Données actualisées. Les montants sont prévisionnels, pas des encaissements.';
    element('metrics').replaceChildren();
    [[money(state.forecast_cents),'Montant des séjours confirmés dans l’année, ménage inclus'],[state.confirmed_nights,'Nuits réservées'],[state.unpriced_nights,'Nuits libres sans tarif']].forEach(([value,label])=>{const box=document.createElement('div');text(box,'strong',value);text(box,'span',label);element('metrics').append(box)});
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
        cell.title=localDate(day.date)+' : '+({available:'disponible',occupied:'occupé',unpriced:'tarif manquant'}[day.state])+(day.cents===null?'':' / '+money(day.cents));
        cell.setAttribute('aria-label',cell.title+'. Choisir cette date.');cell.disabled=day.date<today;
        cell.addEventListener('click',()=>selectDate(day.date));
      });
      section.append(grid);element('admin-calendar').append(section);
    }
    element('rates').replaceChildren();
    if(!state.rates.length)text(element('rates'),'p','Aucun tarif défini pour cette année. Renseignez vos prix pour ouvrir les demandes.');
    state.rates.forEach(rate=>{
      const actions=record(element('rates'),rate.label,rate.start+' au '+rate.end+' (fin exclue)\nSemaine : '+money(rate.nightly_cents)+' / ven.-sam. : '+money(rate.weekend_cents)+'\nMénage : '+money(rate.cleaning_cents)+' / minimum '+rate.min_nights+' nuits');
      action(actions,'Modifier',()=>{const fields=element('rate-form').elements;Object.entries({id:rate.id,label:rate.label,start:rate.start,end:rate.end,nightly:rate.nightly_cents/100,weekend:rate.weekend_cents/100,cleaning:rate.cleaning_cents/100,min_nights:rate.min_nights}).forEach(([key,value])=>fields.namedItem(key).value=value);fields.namedItem('label').focus()});
      action(actions,'Désactiver',async()=>{await api('rates/'+rate.id+'/deactivate',{});await refresh()});
    });
    element('blocks').replaceChildren();
    if(!state.blocks.length)text(element('blocks'),'p','Aucune période bloquée pour cette année.');
    state.blocks.forEach(block=>{const actions=record(element('blocks'),block.reason,localDate(block.start)+' au '+localDate(block.end));action(actions,'Libérer ces dates',async()=>{await api('blocks/'+block.id+'/deactivate',{});await refresh()})});
    updateSelection();
    element('requests').replaceChildren();
    const labels={pending:'En attente',confirmed:'Confirmé',cancelled:'Annulé',rejected:'Refusé'};
    if(!state.bookings.length)text(element('requests'),'p','Aucune demande sur cette année.');
    state.bookings.forEach(booking=>{
      const actions=record(element('requests'),'N° '+booking.id+' · '+booking.name+' · '+labels[booking.status],booking.arrival+' au '+booking.departure+' / '+booking.guests+' voyageurs\n'+booking.email+'\n'+booking.occasion+'\n'+booking.message+'\nPrix demandé : '+money(booking.total_cents));
      async function change(status){await api('requests/'+booking.id+'/status',{status});await refresh()}
      if(booking.status==='pending'){
        if(booking.total_cents!==null)action(actions,'Confirmer ce séjour',()=>change('confirmed'));
        action(actions,'Refuser la demande',()=>change('rejected'));
      }
      if(booking.status==='confirmed')action(actions,'Annuler et libérer les dates',()=>change('cancelled'));
    });
  }
  element('login').addEventListener('submit',async event=>{event.preventDefault();token=element('admin-token').value;try{await refresh();element('admin-token').value=''}catch(error){token='';element('admin-status').textContent=error.message}});
  element('logout').addEventListener('click',()=>{token='';generation++;element('management').hidden=true;element('login').hidden=false;['rates','blocks','requests','metrics','admin-calendar'].forEach(id=>element(id).replaceChildren());element('admin-status').textContent='Gestion fermée.'});
  element('refresh').addEventListener('click',()=>refresh().catch(error=>element('admin-status').textContent=error.message));
  year.addEventListener('change',()=>refresh().catch(error=>element('admin-status').textContent=error.message));
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
