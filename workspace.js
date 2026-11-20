(() => {
  const element = id => document.getElementById(id);
  const sources = {direct:'Site Le Noyer','ardennes-etape':'Ardennes-étape',villaforyou:'Villa for You',belvilla:'Belvilla',telephone:'Téléphone',autre:'Autre'};
  const statuses = {pending:'En attente',confirmed:'Confirmée',cancelled:'Annulée',rejected:'Refusée'};
  const directFlags = {access_sent:'Informations d’accès transmises',reception_ready:'Accueil préparé',cleaning_done:'Ménage effectué'};
  const externalFlags = {reception_ready:'Accueil préparé',cleaning_done:'Ménage effectué'};
  const money = value => value===null?'À compléter':new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR'}).format(value/100);
  const dateLabel = value => new Intl.DateTimeFormat('fr-BE',{dateStyle:'medium'}).format(new Date(value+'T12:00:00'));
  const dateInput = value => new Intl.DateTimeFormat('fr-BE',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00'));
  const daysUntil = value => {
    const [year,month,day]=value.split('-').map(Number),now=new Date();
    return Math.round((Date.UTC(year,month-1,day)-Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
  };
  const statusLabel = row => row.status==='pending'&&row.source!=='direct'?'À valider':(statuses[row.status]||row.status);
  let api, refresh, current, currentRates = [], activePage = 'dashboard';
  let selectedRates = new Set();
  let lastYear = null;

  function text(parent, tag, value, className) {
    const node = document.createElement(tag);node.textContent=value;
    if(className)node.className=className;parent.append(node);return node;
  }
  function notice(message) {element('erp-status').textContent=message;}
  function button(parent,label,callback,className='') {
    const node=text(parent,'button',label,className);node.type='button';
    node.addEventListener('click',async()=>{node.disabled=true;try{await callback()}catch(error){notice(error.message)}finally{node.disabled=false}});
    return node;
  }
  const eventLabels={history_tracking_started:'Suivi chronologique activé',request_received:'Demande reçue sur le site',reservation_confirmed:'Réservation confirmée',reservation_cancelled:'Réservation annulée',request_rejected:'Demande refusée',external_reservation_received:'Réservation externe enregistrée',external_reservation_updated:'Dossier externe modifié',external_dates_validated:'Dates validées',payment_validated:'Paiement validé',quote_email_sent:'Devis envoyé par e-mail',quote_marked_sent_manually:'Devis envoyé après copie',followup_email_sent:'Relance envoyée par e-mail',followup_marked_sent_manually:'Relance envoyée après copie',payment_email_sent:'Confirmation de paiement envoyée',reservation_confirmation_email_sent:'Confirmation de réservation envoyée',arrival_information_email_sent:'Informations d’arrivée envoyées',reservation_confirmation_sent_manually:'Confirmation de réservation envoyée après copie',arrival_information_sent_manually:'Informations d’arrivée envoyées après copie',email_send_failed:'Échec de l’envoi du courriel',message_prepared:'Brouillon préparé',message_sent_manually:'Message envoyé après copie',checklist_step_updated:'Étape du séjour mise à jour',private_note_updated:'Note privée modifiée',cleaning_instructions_updated:'Consignes ménage modifiées',cleaning_team_notified:'Consignes transmises à l’équipe ménage'};
  function appendTimeline(parent,row) {
    const section=document.createElement('section');section.className='event-timeline';text(section,'h3','Historique du dossier');
    const list=document.createElement('ol');
    [...(row.timeline||[])].reverse().forEach(event=>{
      const item=document.createElement('li');item.className=event.event_type==='email_send_failed'?'timeline-error':'';
      const head=document.createElement('div');head.className='timeline-head';
      let when=event.created_at;try{when=new Intl.DateTimeFormat('fr-BE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(event.created_at))}catch{}
      const detail=event.details||{};let description='';
      const messageNames={quote:'Devis',followup:'Relance',payment:'Courriel de paiement',arrival:'Informations d’arrivée',unavailable:'Réponse d’indisponibilité',rejection:'Réponse de refus',cancellation:'Confirmation d’annulation'};
      const title=event.event_type==='message_prepared'?(messageNames[detail.kind]||'Message')+' préparé (brouillon)':event.event_type==='message_sent_manually'?(messageNames[detail.kind]||'Message')+' envoyé après copie':event.event_type==='email_send_failed'?'Ancien essai automatique non envoyé — mode manuel actif':eventLabels[event.event_type]||event.event_type.replaceAll('_',' ');
      text(head,'strong',title);text(head,'time',when);
      if(event.event_type==='history_tracking_started')description='L’historique antérieur n’est pas disponible. Statut actuel : '+(statuses[detail.existing_status]||detail.existing_status||'inconnu')+'.';
      else if(event.event_type==='payment_validated')description=money(detail.amount_cents)+' · '+({transfer:'Virement bancaire',card:'Carte',cash:'Espèces',other:'Autre'}[detail.method]||'')+(detail.reference?' · Réf. '+detail.reference:'')+(detail.fully_paid?' · Solde réglé':' · Reste '+money(detail.balance_cents));
      else if(event.event_type==='email_send_failed')description=detail.reason||'Le message n’a pas été envoyé.';
      else if(event.event_type==='quote_email_sent'||event.event_type==='quote_marked_sent_manually'||event.event_type==='followup_email_sent'||event.event_type==='followup_marked_sent_manually'||event.event_type==='payment_email_sent'||event.event_type==='reservation_confirmation_email_sent'||event.event_type==='arrival_information_email_sent'||event.event_type==='reservation_confirmation_sent_manually'||event.event_type==='arrival_information_sent_manually'||event.event_type==='message_sent_manually')description=detail.recipient||'';
      else if(event.event_type==='message_prepared'&&detail.kind==='followup')description=detail.subject||'';
      else if(event.event_type==='checklist_step_updated')description=(directFlags[detail.step]||externalFlags[detail.step]||detail.step)+': '+(detail.completed?'terminé':'à refaire');
      else if(event.event_type==='cleaning_team_notified')description='Départ du '+(detail.departure?dateLabel(detail.departure):'séjour')+' · '+({whatsapp:'WhatsApp',share:'menu de partage',copy:'copie manuelle'}[detail.channel]||'canal non précisé')+'. Transmission déclarée par vous.';
      else if(detail.arrival)description=dateLabel(detail.arrival)+' → '+dateLabel(detail.departure)+(detail.source?' · '+(sources[detail.source]||detail.source):'');
      if(description)text(item,'p',description);item.prepend(head);list.append(item);
    });
    if(!list.children.length)text(section,'p','Aucune étape enregistrée pour le moment.');else section.append(list);
    parent.append(section);
  }
  function appendPayments(parent,row) {
    const panel=document.createElement('section');panel.className='payment-panel';text(panel,'h3','Paiements');
    text(panel,'p','Reçu : '+money(row.paid_cents)+' · Solde : '+money(row.balance_cents),'payment-summary');
    const list=document.createElement('ul');(row.payments||[]).forEach(payment=>{const item=document.createElement('li');let when=payment.verified_at;try{when=new Intl.DateTimeFormat('fr-BE',{dateStyle:'medium'}).format(new Date(payment.verified_at))}catch{};text(item,'span',money(payment.amount_cents)+' · '+when+' · '+({transfer:'Virement',card:'Carte',cash:'Espèces',other:'Autre'}[payment.method]||payment.method));if(payment.reference)text(item,'span','Réf. '+payment.reference);if(!payment.message_sent)button(item,'Préparer le courriel',()=>prepare(row,'payment',payment.id),'btn btn-outline');list.append(item)});if(list.children.length)panel.append(list);
    if(row.has_quote&&row.email&&row.status!=='cancelled'&&row.status!=='rejected'&&row.balance_cents>0){
      const form=document.createElement('form');form.className='payment-form';const fields=document.createElement('div');fields.className='payment-fields';
      const amountLabel=text(fields,'label','Montant reçu (€)'),amount=document.createElement('input');amount.type='number';amount.min='0.01';amount.max=(row.balance_cents/100).toFixed(2);amount.step='0.01';amount.required=true;amount.inputMode='decimal';amountLabel.append(amount);
      const methodLabel=text(fields,'label','Mode de paiement'),method=document.createElement('select');[['transfer','Virement bancaire'],['card','Carte'],['cash','Espèces'],['other','Autre']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;method.append(option)});methodLabel.append(method);
      const refLabel=text(fields,'label','Référence (facultatif)'),reference=document.createElement('input');reference.maxLength=150;refLabel.append(reference);fields.append(amountLabel,methodLabel,refLabel);form.append(fields);
      const save=text(form,'button','Valider le paiement');save.type='submit';save.className='btn';const status=text(form,'p','Après validation, le reçu et, si la réservation est confirmée, les informations d’arrivée seront préparés pour être copiés dans votre messagerie.');status.setAttribute('role','status');form.append(save,status);
      form.addEventListener('submit',async event=>{event.preventDefault();if(!amount.reportValidity())return;save.disabled=true;try{const result=await api('requests/'+row.id+'/payment',{amount:amount.value,method:method.value,reference:reference.value,version:row.version});await refresh();const updated=current.records.find(record=>record.id===row.id);if(updated){showRecord(updated);displayDraft(updated,'payment',result.email_draft,result.payment_id)}notice(result.reservation_confirmed?'Paiement validé et réservation confirmée. Le courriel est prêt à copier.':'Paiement enregistré. Le courriel est prêt à copier.')}catch(error){status.textContent=error.message}finally{save.disabled=false}});
      panel.append(form);
    }
    parent.append(panel);
  }
  function cleaningMessage(row,task) {
    const incoming=task.same_day_arrival?current.records.find(item=>item.id===task.same_day_arrival):null;
    const lines=['LE NOYER — PASSAGE MÉNAGE','Date : '+dateInput(task.date),'Créneau de préparation : 9 h à 17 h',
      'Séjour sortant : '+(row.name||sources[row.source]||'Voyageurs')+' · '+row.guests+' personnes'];
    lines.push(incoming?'Nouvelle arrivée le même jour : '+(incoming.name||sources[incoming.source]||'Voyageurs')+' · '+incoming.guests+' personnes, à partir de 17 h.':'Aucune nouvelle arrivée le même jour.');
    lines.push('Adresse : Rue Bierleux 69A, 4990 Lierneux.','Consignes : '+(row.cleaning_note||'Aucune consigne particulière.'));
    return lines.join('\n');
  }
  function openCleaningShare(row,task) {
    const dialog=element('cleaning-share-dialog'),preview=element('cleaning-share-text');
    preview.value=cleaningMessage(row,task);dialog.dataset.bookingId=String(row.id);dialog.dataset.channel='';
    element('cleaning-share-status').textContent='Choisissez un moyen de partage. Après l’envoi dans votre application, revenez ici pour l’inscrire dans l’historique.';
    element('confirm-cleaning-share').disabled=true;
    if(!dialog.open)dialog.showModal();
  }
  async function confirmCleaningShare() {
    const dialog=element('cleaning-share-dialog'),channel=dialog.dataset.channel,id=dialog.dataset.bookingId;
    if(!channel||!id)return;
    await api('requests/'+id+'/cleaning-notified',{channel});dialog.close();await refresh();
    const updated=current.records.find(record=>record.id===Number(id));if(updated)showRecord(updated);
    notice('Transmission des consignes déclarée et inscrite dans l’historique.');
  }
  function showPage(page,updateUrl=false) {
    const titles={dashboard:'Vue d’ensemble',reservations:'Réservations externes','site-requests':'Demandes du site',cleaning:'Accueil & ménage',pricing:'Tarifs du site',availability:'Disponibilités'};
    if(!titles[page])page='dashboard';
    const changed=activePage!==page;activePage=page;
    document.querySelectorAll('[data-erp-page]').forEach(panel=>{panel.hidden=panel.dataset.erpPage!==page});
    document.querySelectorAll('[data-erp-nav]').forEach(link=>{if(link.dataset.erpNav===page)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')});
    element('page-title').textContent=titles[page];
    document.title=titles[page]+' — Le Noyer';
    element('erp-sidebar').classList.remove('is-open');element('mobile-menu').setAttribute('aria-expanded','false');
    if(changed){window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});element('page-title').focus({preventScroll:true})}
    if(updateUrl&&location.hash!=='#'+page)history.pushState(null,'','#'+page);
  }
  function showRecord(row) {
    showPage(row.source==='direct'?'site-requests':'reservations',true);
    const dialog=element('record-dialog'),content=element('record-content');content.replaceChildren();
    element('record-title').textContent=(row.name||sources[row.source]||'Séjour')+' · n° '+row.id;
    content.className='record-workspace';
    const grid=document.createElement('div');grid.className='record-workspace-grid';
    const reading=document.createElement('main');reading.className='record-reading';
    const aside=document.createElement('aside');aside.className='record-control';
    const status=text(reading,'span',statusLabel(row),'record-status status-'+row.status);
    const summary=document.createElement('div');summary.className='record-summary-grid';
    const facts=row.source==='direct' ? [
      ['Séjour',dateLabel(row.arrival)+' → '+dateLabel(row.departure)],['Voyageurs',row.guests+' personnes'],
      ['Montant',money(row.total_cents)],['E-mail',row.email||'À compléter']
    ] : [
      ['Plateforme',sources[row.source]||'Autre'],['Référence',row.reference||'Non renseignée'],
      ['Arrivée',dateInput(row.arrival)],['Départ',dateInput(row.departure)],['Voyageurs',row.guests+' personnes'],
      ['Contact',row.email||'Non renseigné']
    ];
    facts.forEach(([label,value])=>{const item=document.createElement('div');item.className='record-fact';text(item,'span',label);text(item,'strong',value);summary.append(item)});
    reading.append(status,summary);
    if(row.conflict)text(reading,'p','Ces dates chevauchent une autre réservation ou un blocage. Vérifie le calendrier avant de valider.','workspace-warning record-alert');
    if(row.message){const original=document.createElement('details');original.className='record-source-message';text(original,'summary',row.source==='direct'?'Message du client':'Note / message de la plateforme');text(original,'p',row.message,'original-message');reading.append(original)}
    const actions=document.createElement('div');actions.className='record-actions record-dialog-actions';aside.append(actions);
    if(row.source!=='direct'&&row.status==='pending')button(actions,'Modifier les dates / informations',()=>editInquiry(row),'btn btn-outline');
    if(row.status==='pending'&&row.confirmable&&!row.conflict)button(actions,row.source==='direct'?'Confirmer la réservation':'Valider les dates',async()=>{await api('requests/'+row.id+'/status',{status:'confirmed'});await refresh();const updated=current.records.find(record=>record.id===row.id);if(updated){showRecord(updated);if(row.source==='direct')await prepare(updated,'arrival')}notice(row.source==='direct'?'Réservation confirmée. Le courriel d’arrivée est prêt à copier.':'Dates validées et bloquées dans le calendrier.')},'btn');
    if(row.status==='pending'&&row.source==='direct')button(actions,'Refuser la demande',async()=>{if(!window.confirm('Refuser cette demande du site ?'))return;await api('requests/'+row.id+'/status',{status:'rejected'});await refresh();const updated=current.records.find(record=>record.id===row.id);if(updated){showRecord(updated);await prepare(updated,'rejection')}},'btn btn-muted');
    if(row.status==='confirmed')button(actions,row.source==='direct'?'Annuler et libérer les dates':'Retirer du calendrier',async()=>{const message=row.source==='direct'?'Annuler cette réservation et libérer les dates ?':'Confirme que la réservation a été annulée sur la plateforme avant de libérer les dates ici.';if(!window.confirm(message))return;await api('requests/'+row.id+'/status',{status:'cancelled'});await refresh();const updated=current.records.find(record=>record.id===row.id);if(updated){showRecord(updated);if(row.source==='direct')await prepare(updated,'cancellation')}},'btn btn-muted');
    if(row.source==='direct'){
      const drafts=document.createElement('div');drafts.className='record-actions record-draft-actions';aside.append(drafts);
      if(row.package&&['pending','confirmed'].includes(row.status)&&!row.conflict)button(drafts,'Préparer le devis',()=>prepare(row,'quote'),'btn btn-outline');
      if(row.status==='pending'){
        button(drafts,'Préparer une relance',()=>prepare(row,'followup'),'btn btn-outline');
      }
      if(row.conflict)button(drafts,'Réponse indisponible',()=>prepare(row,'unavailable'),'btn btn-outline');
      if(row.status==='confirmed'&&row.package)button(drafts,'Préparer la confirmation et les informations d’arrivée',()=>prepare(row,'arrival'),'btn btn-outline');
      if(row.status==='rejected')button(drafts,'Préparer la réponse de refus',()=>prepare(row,'rejection'),'btn btn-outline');
      if(row.status==='cancelled')button(drafts,'Préparer la confirmation d’annulation',()=>prepare(row,'cancellation'),'btn btn-outline');
    }
    if(row.source==='direct'&&row.has_quote)appendPayments(aside,row);
    const form=document.createElement('form');form.className='record-followup';text(form,'h3',row.source==='direct'?'Progression du dossier':'Préparation du séjour');
    if(row.source==='direct')text(form,'p','Coordonnées '+(row.name&&row.email?'complètes':'à compléter')+' · Devis '+(row.has_quote?'préparé':'à compléter')+' · '+statusLabel(row));
    else text(form,'p',row.status==='confirmed'?'Cochez les étapes lorsqu’elles sont prêtes. Le suivi commercial reste géré par la plateforme.':'Validez les dates après avoir vérifié les chevauchements.');
    const flags=row.source==='direct'?directFlags:externalFlags;
    Object.entries(flags).forEach(([key,label])=>{const wrapper=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.name=key;input.checked=Boolean(row.checklist[key]);wrapper.append(input,document.createTextNode(label));form.append(wrapper)});
    const noteLabel=document.createElement('label');noteLabel.textContent='Note privée pour l’équipe';const notes=document.createElement('textarea');notes.name='notes';notes.rows=3;notes.maxLength=4000;notes.value=row.notes;noteLabel.append(notes);form.append(noteLabel);
    if(row.status==='confirmed'){
      const cleaningLabel=document.createElement('label');cleaningLabel.textContent='Consignes destinées à l’équipe de nettoyage';const cleaningNote=document.createElement('textarea');cleaningNote.name='cleaning_note';cleaningNote.rows=4;cleaningNote.maxLength=2000;cleaningNote.value=row.cleaning_note||'';cleaningNote.placeholder='Ex. attention au poêle, linge à laisser dans le local…';cleaningLabel.append(cleaningNote);form.append(cleaningLabel);
      text(form,'p','Ces consignes seront incluses dans le message de partage. La note privée reste confidentielle.','form-hint');
    }
    const save=text(form,'button','Enregistrer le suivi');save.type='submit';save.className='btn btn-outline';
    const statusText=text(form,'p','');statusText.setAttribute('role','status');statusText.setAttribute('aria-live','polite');
    form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{
      const checklist=Object.fromEntries(Object.keys(flags).map(key=>[key,form.elements.namedItem(key).checked]));
      await api('requests/'+row.id+'/workflow',{version:row.version,notes:notes.value,cleaning_note:form.elements.namedItem('cleaning_note')?.value||row.cleaning_note||'',checklist});await refresh();const updated=current.records.find(record=>record.id===row.id);if(updated)showRecord(updated);notice('Suivi du séjour n° '+row.id+' enregistré.');
    }catch(error){statusText.textContent=error.message}finally{save.disabled=false}});
    aside.append(form);appendTimeline(reading,row);grid.append(reading,aside);content.append(grid);
    if(!dialog.open)dialog.showModal();
  }
  function openRecord(identifier) {
    const row=current?.records.find(record=>record.id===identifier);
    if(row)showRecord(row);
  }
  function workflowPayload(row) {return {version:row.version,notes:row.notes,cleaning_note:row.cleaning_note||'',checklist:{...row.checklist}}}
  function displayDraft(row,kind,draft,paymentId=null) {
    element('draft-recipient').textContent=draft.recipient || 'Adresse du voyageur à compléter';
    element('draft-subject').value=draft.subject;element('draft-body').value=draft.body;
    element('draft-status').textContent='Courriel préparé. Copiez-le dans votre messagerie privée, envoyez-le, puis confirmez l’envoi pour l’inscrire dans l’historique.';
    const validateSent=element('mark-message-sent');validateSent.hidden=false;validateSent.disabled=true;validateSent.dataset.bookingId=String(row.id);validateSent.dataset.kind=kind;validateSent.dataset.paymentId=paymentId||'';
    validateSent.textContent='J’ai envoyé ce message, valider l’étape';
    element('message-draft').showModal();
  }
  async function prepare(row,kind,paymentId=null) {
    const draft=await api('requests/'+row.id+'/draft',{kind,payment_id:paymentId});
    if(current)displayDraft(row,kind,draft,paymentId);
  }
  function editInquiry(row) {
    element('record-dialog').close();showPage('reservations',true);
    const form=element('external-form');
    const data={id:row.id,version:row.version,source:row.source,reference:row.reference||'',name:row.name,email:row.email,
      arrival:row.arrival,departure:row.departure,guests:row.guests,message:row.message};
    Object.entries(data).forEach(([key,value])=>{const input=form.elements.namedItem(key);if(input)input.value=value||''});
    element('new-inquiry').open=true;element('import-feedback').textContent='Modification du dossier n° '+row.id+'.';
    form.scrollIntoView({block:'start'});form.elements.namedItem('arrival').focus();
  }
  function recordCard(row) {
    const card=document.createElement('article');card.className='erp-record';
    const leading=document.createElement('div');leading.className='record-leading';
    text(leading,'span',sources[row.source]||'Autre','source-label');
    text(leading,'h3',row.name||'Voyageur à renseigner');
    if(row.source!=='direct')text(leading,'p','Réf. '+(row.reference||'à ajouter'));
    card.append(leading);
    const stay=document.createElement('div');stay.className='record-stay';
    text(stay,'strong',dateLabel(row.arrival)+' → '+dateLabel(row.departure));
    text(stay,'span',row.guests+' voyageurs'+(row.source==='direct'?' · '+money(row.total_cents):''));card.append(stay);
    const status=text(card,'span',statusLabel(row),'record-status status-'+row.status);
    if(row.conflict)text(card,'span','Chevauchement','record-status status-conflict');
    const actionArea=document.createElement('div');actionArea.className='record-card-action';
    button(actionArea,'Ouvrir la fiche',()=>showRecord(row),'btn btn-outline');card.append(actionArea);
    return card;
  }
  function renderRecordLists() {
    const platformSource=element('platform-source').value,platformSearch=element('platform-search').value.trim().toLocaleLowerCase('fr-BE');
    const siteSearch=element('site-search').value.trim().toLocaleLowerCase('fr-BE');
    const external=current.records.filter(row=>row.source!=='direct'&&matchesStatus(row,element('platform-status').value)&&
      (platformSource==='all'||row.source===platformSource)&&matchesSearch(row,platformSearch));
    const direct=current.records.filter(row=>row.source==='direct'&&matchesStatus(row,element('site-status').value)&&matchesSearch(row,siteSearch));
    renderList('requests-platforms',external,'Aucune réservation externe pour ce filtre.');
    renderList('requests-site',direct,'Aucune demande du site pour ce filtre.');
    element('platform-count').textContent=external.length+' dossier'+(external.length===1?'':'s')+' affiché'+(external.length===1?'':'s')+' sur l’année et les séjours proches.';
  }
  function matchesStatus(row,status) {return status==='all'||row.status===status}
  function matchesSearch(row,search) {
    if(!search)return true;
    return [row.id,row.name,row.email,row.reference,row.arrival,row.departure,sources[row.source]].some(value=>String(value||'').toLocaleLowerCase('fr-BE').includes(search));
  }
  function renderList(id,rows,empty) {
    const parent=element(id);parent.replaceChildren();
    if(!rows.length){const state=document.createElement('div');state.className='empty-state';text(state,'strong',empty);text(state,'p','Les nouveaux dossiers apparaîtront ici après leur enregistrement.');parent.append(state);return}
    rows.sort((a,b)=>a.arrival.localeCompare(b.arrival)||a.id-b.id).forEach(row=>parent.append(recordCard(row)));
  }
  function renderToday() {
    const parent=element('today-content');parent.replaceChildren();
    const pendingExternal=current.records.filter(row=>row.source!=='direct'&&row.status==='pending'&&row.departure>current.today);
    const pendingDirect=current.records.filter(row=>row.source==='direct'&&row.status==='pending'&&row.departure>current.today);
    const arrivals=current.records.filter(row=>row.status==='confirmed'&&row.arrival===current.today);
    const departures=current.records.filter(row=>row.status==='confirmed'&&row.departure===current.today);
    const upcoming=current.records.filter(row=>row.status==='confirmed'&&row.arrival>current.today&&daysUntil(row.arrival)<=14);
    const conflicts=current.records.filter(row=>row.conflict&&row.departure>current.today);
    const groups=[
      ['Réservations à valider',pendingExternal,'reservations'],['Demandes du site',pendingDirect,'site-requests'],
      ['Arrivées aujourd’hui',arrivals,'cleaning'],['Départs aujourd’hui',departures,'cleaning'],
      ['Arrivées dans 14 jours',upcoming,'cleaning'],['Dates à vérifier',conflicts,'reservations']
    ];
    groups.forEach(([label,rows,page])=>{
      const section=document.createElement('section');section.className='today-section';
      const heading=document.createElement('div');heading.className='today-section-head';text(heading,'h2',label);text(heading,'span',String(rows.length),'today-count');section.append(heading);
      if(!rows.length)text(section,'p','Rien à traiter.','today-empty');
      rows.slice(0,5).forEach(row=>{
        const task=document.createElement('div');task.className='dashboard-task';
        const details=document.createElement('div');text(details,'strong',row.name||sources[row.source]);text(details,'span',dateLabel(row.arrival)+' → '+dateLabel(row.departure));task.append(details);
        if(page==='cleaning'&&row.arrival>current.today)text(task,'span','J−'+daysUntil(row.arrival),'countdown');
        button(task,'Voir',()=>{showPage(page,true);showRecord(row)},'task-open');section.append(task);
      });
      if(rows.length>5)button(section,'Voir les '+rows.length+' dossiers',()=>showPage(page,true),'view-all');
      parent.append(section);
    });
  }
  function renderReception() {
    const parent=element('reception-list');parent.replaceChildren();
    const rows=current.records.filter(row=>row.status==='confirmed'&&row.arrival>=current.today).sort((a,b)=>a.arrival.localeCompare(b.arrival));
    if(!rows.length){const empty=document.createElement('div');empty.className='empty-state';text(empty,'strong','Aucune arrivée à préparer.');text(empty,'p','Les séjours confirmés apparaîtront ici à l’approche de leur arrivée.');parent.append(empty);return}
    rows.forEach(row=>{
      const card=document.createElement('article');card.className='operation-row';
      const date=document.createElement('div');date.className='operation-date';text(date,'strong',dateLabel(row.arrival));text(date,'span',row.arrival===current.today?'Aujourd’hui':'J−'+daysUntil(row.arrival));card.append(date);
      const info=document.createElement('div');text(info,'strong',row.name||sources[row.source]);text(info,'span',(row.source==='direct'?'Site Le Noyer':sources[row.source])+' · '+row.guests+' voyageurs');card.append(info);
      const ready=Boolean(row.checklist.reception_ready);text(card,'span',ready?'Accueil prêt':'À préparer','record-status '+(ready?'status-confirmed':'status-pending'));
      const actions=document.createElement('div');actions.className='operation-actions';
      button(actions,ready?'Voir le séjour':'Préparer l’accueil',()=>showRecord(row),'btn btn-outline');card.append(actions);parent.append(card);
    });
  }
  function renderCleaning() {
    const parent=element('cleaning-list');parent.replaceChildren();
    const tasks=current.cleaning.filter(task=>task.date>=current.today||!task.done).sort((first,second)=>first.date.localeCompare(second.date));
    if(!tasks.length){const empty=document.createElement('div');empty.className='empty-state';text(empty,'strong','Aucune rotation ménage à venir.');text(empty,'p','Les départs confirmés créeront automatiquement les rotations.');parent.append(empty);return}
    tasks.forEach(task=>{const row=current.records.find(record=>record.id===task.booking_id);if(!row)return;
      const card=document.createElement('article');card.className='operation-row';
      const date=document.createElement('div');date.className='operation-date';text(date,'strong',dateLabel(task.date));text(date,'span','9 h–17 h');card.append(date);
      const info=document.createElement('div');text(info,'strong','Départ · '+(row.name||sources[row.source]));text(info,'span',task.same_day_arrival?'Nouvelle arrivée le même jour':'Maison à préparer pour le prochain séjour');card.append(info);
      text(card,'span',task.done?'Maison prête':'À faire','record-status '+(task.done?'status-confirmed':'status-pending'));
      const actions=document.createElement('div');actions.className='operation-actions';
      button(actions,'Partager les consignes',()=>openCleaningShare(row,task),'btn btn-outline');
      button(actions,task.done?'Annuler la validation':'Marquer la maison prête',async()=>{const payload=workflowPayload(row);payload.checklist.cleaning_done=!task.done;await api('requests/'+row.id+'/workflow',payload);await refresh()},'btn btn-outline');
      button(actions,'Ouvrir la fiche',()=>showRecord(row),'task-open');card.append(actions);parent.append(card);
    });
  }
  function fillRate(rate) {
    showPage('pricing',true);
    const form=element('rate-form');form.reset();
    Object.entries({id:0,label:rate.label+' (copie)',start:rate.start,end:rate.end,midweek:(rate.midweek_cents/100).toFixed(2),weekend:(rate.weekend_cents/100).toFixed(2),cleaning:(rate.cleaning_cents/100).toFixed(2)}).forEach(([key,value])=>form.elements.namedItem(key).value=value);
    form.scrollIntoView({block:'start'});form.elements.namedItem('start').focus();notice('Prix copiés. Choisissez une nouvelle période sans chevauchement, puis enregistrez.');
  }
  function renderRates() {
    const parent=element('rates');parent.replaceChildren();
    if(!currentRates.length){const empty=document.createElement('div');empty.className='empty-state';text(empty,'strong','Aucune période tarifaire.');text(empty,'p','Ajoute une première saison avec le formulaire.');parent.append(empty);return}
    const table=document.createElement('table');table.className='rates-table';const head=document.createElement('thead'),header=document.createElement('tr');
    ['Choisir','Période d’arrivée','Mid-week (€)','Week-end (€)','Ménage (€)','Actions'].forEach(label=>{const cell=text(header,'th',label);cell.scope='col'});head.append(header);table.append(head);const body=document.createElement('tbody');
    currentRates.forEach(rate=>{const row=document.createElement('tr'),selectCell=document.createElement('td'),select=document.createElement('input');select.type='checkbox';select.checked=selectedRates.has(rate.id);select.setAttribute('aria-label','Sélectionner '+rate.label);select.addEventListener('change',()=>{if(select.checked)selectedRates.add(rate.id);else selectedRates.delete(rate.id)});selectCell.append(select);row.append(selectCell);
      text(row,'td',rate.label+' · '+dateLabel(rate.start)+' au '+dateLabel(rate.end)+' (fin exclue)');const inputs={};
      ['midweek','weekend','cleaning'].forEach(key=>{const cell=document.createElement('td'),input=document.createElement('input');input.type='number';input.min=key==='cleaning'?'0':'0.01';input.max='100000';input.step='0.01';input.required=true;input.value=(rate[key+'_cents']/100).toFixed(2);input.setAttribute('aria-label',rate.label+' '+key+' en euros');inputs[key]=input;cell.append(input);row.append(cell)});
      const actions=document.createElement('td');
      button(actions,'Enregistrer',async()=>{if(!Object.values(inputs).every(input=>input.reportValidity()))return;await api('rates',{id:rate.id,label:rate.label,start:rate.start,end:rate.end,...Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value]))});await refresh();notice('Tarif enregistré.')},'table-action');
      button(actions,'Copier la saison',()=>fillRate(rate),'table-action');button(actions,'Désactiver',async()=>{if(!window.confirm('Désactiver cette période tarifaire ?'))return;await api('rates/'+rate.id+'/deactivate',{});await refresh()},'table-action');row.append(actions);body.append(row);
    });table.append(body);parent.append(table);
  }
  function render(workspace,state) {
    current=workspace;currentRates=state.rates;
    if(lastYear!==state.year){selectedRates.clear();lastYear=state.year}
    selectedRates=new Set([...selectedRates].filter(id=>currentRates.some(rate=>rate.id===id)));
    renderToday();renderRecordLists();renderReception();renderCleaning();renderRates();
    element('dashboard-date').textContent=dateInput(current.today);
    const missing=state.days.filter(day=>day.date>=current.today&&day.package&&day.state==='unpriced');
    element('rates-warning').textContent=missing.length?missing.length+' dates d’arrivée sans tarif pour '+state.year+'.':'Les dates d’arrivée disponibles ont un tarif pour '+state.year+'.';
  }
  window.NoyerWorkspace={
    connect(client,reload) {
      api=client;refresh=reload;
      document.querySelectorAll('[data-erp-nav]').forEach(link=>link.addEventListener('click',()=>showPage(link.dataset.erpNav,true)));
      window.addEventListener('hashchange',()=>showPage(location.hash.slice(1)||'dashboard'));
      ['platform-status','platform-source','site-status'].forEach(id=>element(id).addEventListener('change',renderRecordLists));
      ['platform-search','site-search'].forEach(id=>element(id).addEventListener('input',renderRecordLists));
      element('mobile-menu').addEventListener('click',event=>{const sidebar=element('erp-sidebar'),open=!sidebar.classList.contains('is-open');sidebar.classList.toggle('is-open',open);event.currentTarget.setAttribute('aria-expanded',String(open))});
      element('record-close').addEventListener('click',()=>element('record-dialog').close());
      element('record-dialog').addEventListener('click',event=>{if(event.target===element('record-dialog'))element('record-dialog').close()});
      element('cleaning-share-close').addEventListener('click',()=>element('cleaning-share-dialog').close());
      element('cleaning-share-dialog').addEventListener('click',event=>{if(event.target===element('cleaning-share-dialog'))element('cleaning-share-dialog').close()});
      element('cleaning-share-whatsapp').addEventListener('click',()=>{const url='https://wa.me/?text='+encodeURIComponent(element('cleaning-share-text').value);const target=window.open(url,'_blank');if(target){target.opener=null;element('cleaning-share-dialog').dataset.channel='whatsapp';element('confirm-cleaning-share').disabled=false;element('cleaning-share-status').textContent='WhatsApp est ouvert. Choisissez la conversation, envoyez le message, puis confirmez ici.'}else element('cleaning-share-status').textContent='Le navigateur a bloqué la fenêtre. Autorisez les fenêtres contextuelles ou copiez le texte.'});
      element('cleaning-share-native').addEventListener('click',async()=>{try{await navigator.share({title:'Passage ménage — Le Noyer',text:element('cleaning-share-text').value});element('cleaning-share-dialog').dataset.channel='share';element('confirm-cleaning-share').disabled=false;element('cleaning-share-status').textContent='Partage terminé. Confirmez ici après avoir envoyé le message dans l’application choisie.'}catch(error){if(error.name!=='AbortError')element('cleaning-share-status').textContent='Le partage n’a pas abouti. Vous pouvez copier le texte.'}});
      element('cleaning-share-copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(element('cleaning-share-text').value);element('cleaning-share-dialog').dataset.channel='copy';element('confirm-cleaning-share').disabled=false;element('cleaning-share-status').textContent='Consignes copiées. Envoyez-les dans votre messagerie, puis confirmez ici.'}catch{element('cleaning-share-text').focus();element('cleaning-share-text').select();element('cleaning-share-status').textContent='Copie automatique indisponible : le texte est sélectionné. Copiez-le manuellement, envoyez-le, puis confirmez ici.';element('cleaning-share-dialog').dataset.channel='copy';element('confirm-cleaning-share').disabled=false}});
      element('confirm-cleaning-share').addEventListener('click',async event=>{event.currentTarget.disabled=true;try{await confirmCleaningShare()}catch(error){element('cleaning-share-status').textContent=error.message;event.currentTarget.disabled=false}});
      if(!navigator.share)element('cleaning-share-native').hidden=true;
      element('add-platform-booking').addEventListener('click',()=>{element('new-inquiry').open=true;element('new-inquiry').scrollIntoView({block:'start'});element('external-form').elements.namedItem('source').focus()});
      element('extract-email').addEventListener('click',async event=>{const trigger=event.currentTarget;trigger.disabled=true;try{
        const preview=await api('import-preview',{text:element('email-content').value});const form=element('external-form');form.reset();form.elements.namedItem('id').value='';
        Object.entries(preview.fields).forEach(([key,value])=>{const input=form.elements.namedItem(key);if(input)input.value=value});element('import-feedback').textContent=preview.warnings.join('\n');
      }catch(error){element('import-feedback').textContent=error.message}finally{trigger.disabled=false}});
      element('reset-external').addEventListener('click',()=>{element('external-form').reset();element('external-form').elements.namedItem('id').value='';element('import-feedback').textContent='Formulaire vidé.'});
      element('external-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,data=Object.fromEntries(new FormData(form)),trigger=form.querySelector('button[type=submit]');trigger.disabled=true;
        try{const result=await api(data.id?'external/'+data.id:'external',data);element('year').value=data.arrival.slice(0,4);await refresh();form.reset();form.elements.namedItem('id').value='';element('new-inquiry').open=false;showPage('reservations',true);notice('Réservation n° '+result.id+' enregistrée pour validation.'+(result.conflict?' Les dates chevauchent déjà une période occupée.':''));openRecord(result.id)}catch(error){element('import-feedback').textContent=error.message}finally{trigger.disabled=false}});
      element('bulk-rates').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,trigger=form.querySelector('button');trigger.disabled=true;element('bulk-status').textContent='Mise à jour…';try{const result=await api('rates/bulk',{ids:[...selectedRates],...Object.fromEntries(new FormData(form))});await refresh();element('bulk-status').textContent=result.updated+' périodes mises à jour.';notice(result.updated+' périodes mises à jour.')}catch(error){element('bulk-status').textContent=error.message}finally{trigger.disabled=false}});
      element('select-all-rates').addEventListener('click',()=>{selectedRates=new Set(currentRates.map(rate=>rate.id));renderRates()});
      element('draft-close').addEventListener('click',()=>element('message-draft').close());
      element('copy-draft').addEventListener('click',async()=>{const validate=element('mark-message-sent');try{await navigator.clipboard.writeText('Objet : '+element('draft-subject').value+'\n\n'+element('draft-body').value);element('draft-status').textContent='Brouillon copié. Après l’avoir envoyé depuis votre messagerie, validez l’étape ci-dessous.';validate.disabled=false}catch{element('draft-status').textContent='Copie automatique indisponible. Sélectionnez et copiez le texte, puis vous pourrez valider son envoi.';validate.disabled=false}});
      element('mark-message-sent').addEventListener('click',async event=>{const control=event.currentTarget;control.disabled=true;try{const kind=control.dataset.kind,paymentId=control.dataset.paymentId;const result=await api('requests/'+control.dataset.bookingId+'/message-sent',{kind,...(paymentId?{payment_id:Number(paymentId)}:{})});element('message-draft').close();await refresh();const updated=current.records.find(record=>record.id===Number(control.dataset.bookingId));if(updated)showRecord(updated);notice(result.sent?'Envoi confirmé et inscrit dans l’historique.':'L’envoi n’a pas été validé.')}catch(error){element('draft-status').textContent=error.message}finally{control.disabled=false}});
      showPage(location.hash.slice(1)||'dashboard');
    },
    render,
    clear() {
      current=null;currentRates=[];selectedRates.clear();
      ['today-content','reception-list','cleaning-list','requests-platforms','requests-site','rates'].forEach(id=>element(id).replaceChildren());
      element('external-form').reset();element('email-content').value='';element('import-feedback').textContent='';
      element('record-content').replaceChildren();if(element('record-dialog').open)element('record-dialog').close();
      element('draft-body').value='';element('draft-subject').value='';element('draft-recipient').textContent='';element('draft-status').textContent='';
      if(element('message-draft').open)element('message-draft').close();showPage('dashboard',true);
      if(element('cleaning-share-dialog').open)element('cleaning-share-dialog').close();
    }
  };
})();
