(() => {
  const element = id => document.getElementById(id);
  const sources = {direct:'Site Le Noyer','ardennes-etape':'Ardennes-étape',villaforyou:'Villa for You',belvilla:'Belvilla',telephone:'Téléphone',autre:'Autre'};
  const statuses = {pending:'En attente',confirmed:'Confirmé',cancelled:'Annulé',rejected:'Refusé'};
  const flags = {quote_sent:'Devis envoyé (vérification manuelle)',payment_verified:'Règlement vérifié manuellement',access_sent:'Informations d’accès transmises',cleaning_done:'Ménage effectué / maison prête'};
  const money = value => value===null?'Montant à compléter':new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR'}).format(value/100);
  const dateLabel = value => new Intl.DateTimeFormat('fr-BE',{dateStyle:'medium'}).format(new Date(value+'T12:00:00'));
  let api, refresh, current, currentRates = [];
  let selectedRates = new Set();
  let lastYear = null;
  function text(parent, tag, value, className) {
    const node = document.createElement(tag);node.textContent=value;
    if(className)node.className=className;parent.append(node);return node;
  }
  function notice(message) {element('admin-status').textContent=message}
  function button(parent,label,callback) {
    const node=text(parent,'button',label);node.type='button';
    node.addEventListener('click',async()=>{node.disabled=true;try{await callback()}catch(error){notice(error.message)}finally{node.disabled=false}});
    return node;
  }
  function openRecord(identifier) {
    element('inquiry-source').value='all';element('inquiry-status').value='all';renderRecords();
    const details=element('record-'+identifier);
    if(details){details.open=true;details.scrollIntoView({block:'start'});details.querySelector('summary').focus()}
  }
  function workflowPayload(row) {return {version:row.version,notes:row.notes,checklist:{...row.checklist}}}
  async function prepare(row,kind) {
    const draft=await api('requests/'+row.id+'/draft',{kind});
    if(!current)return;
    element('draft-recipient').textContent=draft.recipient || 'Adresse du voyageur à compléter';
    element('draft-subject').value=draft.subject;element('draft-body').value=draft.body;
    element('draft-status').textContent='Brouillon uniquement. Aucun message envoyé et aucune checklist modifiée.';
    element('message-draft').showModal();
  }
  function editInquiry(row) {
    const form=element('external-form');
    const data={id:row.id,version:row.version,source:row.source,reference:row.reference||'',name:row.name,email:row.email,
      arrival:row.arrival,departure:row.departure,guests:row.guests,total:row.total_cents===null?'':(row.total_cents/100).toFixed(2),message:row.message};
    Object.entries(data).forEach(([key,value])=>form.elements.namedItem(key).value=value);
    element('new-inquiry').open=true;element('import-feedback').textContent='Modification du dossier n° '+row.id+'. Vérifiez les informations avant d’enregistrer.';
    form.scrollIntoView({block:'start'});form.elements.namedItem('name').focus();
  }
  function renderRecords() {
    const parent=element('requests');parent.replaceChildren();
    const source=element('inquiry-source').value,status=element('inquiry-status').value;
    const rows=current.records.filter(row=>(source==='all'||row.source===source)&&(status==='all'||row.status===status));
    if(!rows.length)text(parent,'p','Aucun dossier pour ces filtres.');
    rows.forEach(row=>{
      const details=document.createElement('details');details.id='record-'+row.id;details.className='stay-record';
      text(details,'summary','N° '+row.id+' · '+(row.name||'Nom à compléter')+' · '+sources[row.source]+' · '+statuses[row.status]);
      text(details,'p',dateLabel(row.arrival)+' à 17 h → '+dateLabel(row.departure)+' à 9 h · '+row.guests+' voyageurs · '+money(row.total_cents));
      text(details,'p','Référence : '+(row.reference||'Non renseignée')+' · E-mail : '+(row.email||'À compléter'));
      if(row.conflict)text(details,'p','Conflit de dates : une réservation ou un blocage occupe cette période.','workspace-warning');
      if(!row.package)text(details,'p','Ancien dossier sans devis au forfait : confirmation désactivée.');
      const original=document.createElement('details');text(original,'summary','Message reçu');text(original,'p',row.message||'Aucun message renseigné.','original-message');details.append(original);
      const actions=document.createElement('div');actions.className='record-actions';details.append(actions);
      if(row.source!=='direct'&&row.status==='pending')button(actions,'Compléter / modifier',()=>editInquiry(row));
      if(row.status==='pending'&&row.confirmable&&!row.conflict)button(actions,'Confirmer ce séjour',async()=>{await api('requests/'+row.id+'/status',{status:'confirmed'});await refresh()});
      if(row.status==='pending')button(actions,'Refuser',async()=>{await api('requests/'+row.id+'/status',{status:'rejected'});await refresh()});
      if(row.status==='confirmed')button(actions,'Annuler et libérer',async()=>{await api('requests/'+row.id+'/status',{status:'cancelled'});await refresh()});
      const drafts=document.createElement('div');drafts.className='record-actions';details.append(drafts);
      if(row.package&&['pending','confirmed'].includes(row.status)&&!row.conflict)button(drafts,'Préparer le devis',()=>prepare(row,'quote'));
      if(row.status==='pending')button(drafts,'Préparer une relance',()=>prepare(row,'followup'));
      if(row.conflict)button(drafts,'Réponse indisponible',()=>prepare(row,'unavailable'));
      if(row.status==='confirmed'&&row.package)button(drafts,'Informations d’arrivée',()=>prepare(row,'arrival'));
      const form=document.createElement('form');form.className='stay-checklist';
      text(form,'h3','Suivi du séjour');
      text(form,'p','Coordonnées : '+(row.name&&row.email?'complètes':'à compléter')+' · Devis : '+(row.has_quote?'préparé':'à compléter')+' · '+statuses[row.status]);
      Object.entries(flags).forEach(([key,label])=>{const wrapper=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.name=key;input.checked=Boolean(row.checklist[key]);wrapper.append(input,document.createTextNode(label));form.append(wrapper)});
      const label=document.createElement('label');label.textContent='Notes privées';const notes=document.createElement('textarea');notes.name='notes';notes.rows=3;notes.maxLength=4000;notes.value=row.notes;label.append(notes);form.append(label);
      const save=text(form,'button','Enregistrer le suivi');save.type='submit';save.className='btn';
      const statusText=text(form,'p','');statusText.setAttribute('role','status');
      form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{
        const checklist=Object.fromEntries(Object.keys(flags).map(key=>[key,form.elements.namedItem(key).checked]));
        await api('requests/'+row.id+'/workflow',{version:row.version,notes:notes.value,checklist});await refresh();openRecord(row.id);notice('Suivi du dossier n° '+row.id+' enregistré.');
      }catch(error){statusText.textContent=error.message}finally{save.disabled=false}});
      details.append(form);parent.append(details);
    });
  }
  function renderToday(state) {
    const parent=element('today-content');parent.replaceChildren();
    const sections=[['Demandes à traiter',current.pending],['Arrivées aujourd’hui à 17 h',current.arrivals],['Départs aujourd’hui à 9 h',current.departures],['Arrivées dans les 14 jours',current.upcoming],['Conflits à vérifier',current.conflicts]];
    sections.forEach(([label,identifiers])=>{const section=document.createElement('div');section.className='today-section';text(section,'h3',label+' ('+identifiers.length+')');
      if(!identifiers.length)text(section,'p','Rien à traiter.');
      identifiers.forEach(identifier=>{const row=current.records.find(record=>record.id===identifier);if(row)button(section,'N° '+row.id+' · '+(row.name||sources[row.source])+' · '+dateLabel(row.arrival),()=>openRecord(identifier))});parent.append(section)});
    const missing=state.days.filter(day=>day.date>=current.today&&day.package&&day.state==='unpriced');
    const warning=element('rates-warning');warning.textContent=missing.length?missing.length+' arrivées lundi/vendredi sans forfait sur l’année affichée. Complétez la grille pour ouvrir ces séjours.':'Tous les départs de forfait libres à venir sur l’année affichée ont un tarif.';
  }
  function renderCleaning() {
    const parent=element('cleaning-list');parent.replaceChildren();
    const tasks=current.cleaning.filter(task=>task.date>=current.today||!task.done).sort((first,second)=>first.date.localeCompare(second.date));
    if(!tasks.length)text(parent,'p','Aucune rotation à préparer sur cette année.');
    tasks.forEach(task=>{const row=current.records.find(record=>record.id===task.booking_id);if(!row)return;
      const line=document.createElement('div');line.className='cleaning-row';text(line,'p',dateLabel(task.date)+' · 9 h–17 h · départ n° '+row.id+(task.same_day_arrival?' / arrivée n° '+task.same_day_arrival+' le même jour':''));
      text(line,'p',task.done?'Maison prête':task.date<current.today?'Ménage passé non validé':'Ménage à effectuer',task.done?'':'workspace-warning');
      const actions=document.createElement('div');actions.className='record-actions';
      button(actions,task.done?'Marquer à refaire':'Marquer la maison prête',async()=>{const payload=workflowPayload(row);payload.checklist.cleaning_done=!task.done;await api('requests/'+row.id+'/workflow',payload);await refresh()});
      button(actions,'Ouvrir le séjour',()=>openRecord(row.id));line.append(actions);parent.append(line);
    });
  }
  function fillRate(rate) {
    const form=element('rate-form');form.reset();
    Object.entries({id:0,label:rate.label+' (copie)',start:rate.start,end:rate.end,midweek:(rate.midweek_cents/100).toFixed(2),weekend:(rate.weekend_cents/100).toFixed(2),cleaning:(rate.cleaning_cents/100).toFixed(2)}).forEach(([key,value])=>form.elements.namedItem(key).value=value);
    form.scrollIntoView({block:'start'});form.elements.namedItem('start').focus();notice('Prix copiés. Choisissez une nouvelle période sans chevauchement, puis enregistrez.');
  }
  function renderRates() {
    const parent=element('rates');parent.replaceChildren();
    if(!currentRates.length){text(parent,'p','Aucune période tarifaire. Ajoutez votre première saison ci-dessus.');return}
    const table=document.createElement('table');table.className='rates-table';const head=document.createElement('thead'),header=document.createElement('tr');
    ['Sélection','Période d’arrivée','Mid-week complet (€)','Week-end complet (€)','Ménage (€)','Actions'].forEach(label=>{const cell=text(header,'th',label);cell.scope='col'});head.append(header);table.append(head);const body=document.createElement('tbody');
    currentRates.forEach(rate=>{const row=document.createElement('tr'),selectCell=document.createElement('td'),select=document.createElement('input');select.type='checkbox';select.checked=selectedRates.has(rate.id);select.setAttribute('aria-label','Sélectionner '+rate.label);select.addEventListener('change',()=>{if(select.checked)selectedRates.add(rate.id);else selectedRates.delete(rate.id)});selectCell.append(select);row.append(selectCell);
      text(row,'td',rate.label+' · '+dateLabel(rate.start)+' au '+dateLabel(rate.end)+' (fin exclue)');const inputs={};
      ['midweek','weekend','cleaning'].forEach(key=>{const cell=document.createElement('td'),input=document.createElement('input');input.type='number';input.min=key==='cleaning'?'0':'0.01';input.max='100000';input.step='0.01';input.required=true;input.value=(rate[key+'_cents']/100).toFixed(2);input.setAttribute('aria-label',rate.label+' '+key+' en euros');inputs[key]=input;cell.append(input);row.append(cell)});
      const actions=document.createElement('td');
      button(actions,'Enregistrer',async()=>{if(!Object.values(inputs).every(input=>input.reportValidity()))return;await api('rates',{id:rate.id,label:rate.label,start:rate.start,end:rate.end,...Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value]))});await refresh();notice('Tarif enregistré.')});
      button(actions,'Copier la saison',()=>fillRate(rate));button(actions,'Désactiver',async()=>{await api('rates/'+rate.id+'/deactivate',{});await refresh()});row.append(actions);body.append(row);
    });table.append(body);parent.append(table);
  }
  window.NoyerWorkspace = {
    connect(client,reload) {
      api=client;refresh=reload;
      ['inquiry-source','inquiry-status'].forEach(id=>element(id).addEventListener('change',renderRecords));
      element('extract-email').addEventListener('click',async event=>{const trigger=event.currentTarget;trigger.disabled=true;try{
        const preview=await api('import-preview',{text:element('email-content').value});const form=element('external-form');form.reset();form.elements.namedItem('id').value='';Object.entries(preview.fields).forEach(([key,value])=>form.elements.namedItem(key).value=value);element('import-feedback').textContent=preview.warnings.join('\n');
      }catch(error){element('import-feedback').textContent=error.message}finally{trigger.disabled=false}});
      element('reset-external').addEventListener('click',()=>{element('external-form').reset();element('external-form').elements.namedItem('id').value='';element('import-feedback').textContent='Nouveau dossier : complétez les champs avant d’enregistrer.'});
      element('external-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form)),trigger=form.querySelector('button[type=submit]');trigger.disabled=true;
        try{const result=await api(data.id?'external/'+data.id:'external',data);element('year').value=data.arrival.slice(0,4);await refresh();form.reset();form.elements.namedItem('id').value='';element('import-feedback').textContent='Dossier n° '+result.id+' enregistré en attente.'+(result.conflict?' Attention : conflit de dates à résoudre.':'');openRecord(result.id)}catch(error){element('import-feedback').textContent=error.message}finally{trigger.disabled=false}});
      element('bulk-rates').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,trigger=form.querySelector('button');trigger.disabled=true;element('bulk-status').textContent='Mise à jour…';try{const result=await api('rates/bulk',{ids:[...selectedRates],...Object.fromEntries(new FormData(form))});await refresh();element('bulk-status').textContent=result.updated+' périodes mises à jour.';notice(result.updated+' périodes mises à jour.')}catch(error){element('bulk-status').textContent=error.message}finally{trigger.disabled=false}});
      element('select-all-rates').addEventListener('click',()=>{selectedRates=new Set(currentRates.map(rate=>rate.id));renderRates()});
      element('draft-close').addEventListener('click',()=>element('message-draft').close());
      element('copy-draft').addEventListener('click',async()=>{try{await navigator.clipboard.writeText('Objet : '+element('draft-subject').value+'\n\n'+element('draft-body').value);element('draft-status').textContent='Brouillon copié. Collez-le dans votre messagerie ou sur la plateforme, puis vérifiez avant d’envoyer.'}catch{element('draft-status').textContent='Copie automatique indisponible. Sélectionnez le texte et copiez-le manuellement.'}});
    },
    render(workspace,state) {
      current=workspace;currentRates=state.rates;
      if(lastYear!==state.year){selectedRates.clear();lastYear=state.year}
      selectedRates=new Set([...selectedRates].filter(id=>currentRates.some(rate=>rate.id===id)));
      renderRecords();renderToday(state);renderCleaning();renderRates();
    },
    clear() {
      current=null;currentRates=[];selectedRates.clear();
      ['today-content','cleaning-list','requests','rates'].forEach(id=>element(id).replaceChildren());
      element('external-form').reset();element('email-content').value='';element('import-feedback').textContent='';
      element('draft-body').value='';element('draft-subject').value='';element('draft-recipient').textContent='';element('draft-status').textContent='';
      if(element('message-draft').open)element('message-draft').close();
    }
  };
})();
