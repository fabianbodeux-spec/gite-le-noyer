(() => {
  const element = id => document.getElementById(id);
  const sources = {direct:'Site Le Noyer','ardennes-etape':'Ardennes-étape',villaforyou:'Villa for You',belvilla:'Belvilla',telephone:'Téléphone',autre:'Autre'};
  const statuses = {pending:'En attente',confirmed:'Confirmée',cancelled:'Annulée',rejected:'Refusée'};
  const directFlags = {access_sent:'Informations d’accès transmises',reception_ready:'Accueil préparé',cleaning_done:'Ménage effectué'};
  const externalFlags = {reception_ready:'Accueil préparé',cleaning_done:'Ménage effectué'};
  const money = value => value===null?'À compléter':new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR'}).format(value/100).replace(/\u202f/g,'\u00a0');
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
  function reportActionError(error) {
    const feedback=element('record-action-feedback');
    if(feedback&&element('record-dialog').open){feedback.hidden=false;feedback.textContent=error.message}
    else notice(error.message);
  }
  function button(parent,label,callback,className='') {
    const node=text(parent,'button',label,className);node.type='button';
    node.addEventListener('click',async()=>{node.disabled=true;const feedback=element('record-action-feedback');if(feedback)feedback.hidden=true;try{await callback()}catch(error){reportActionError(error)}finally{node.disabled=false}});
    return node;
  }
  function sentMessage(row,kind,paymentId=null) {
    const events=row.timeline||[];
    if(events.some(event=>event.event_type==='message_sent_manually'&&event.details?.kind===kind&&
      (kind!=='payment'||Number(event.details?.payment_id)===Number(paymentId))))return true;
    const legacy={quote:['quote_marked_sent_manually','quote_email_sent'],followup:['followup_marked_sent_manually','followup_email_sent'],payment:['payment_email_sent'],arrival:['arrival_information_sent_manually','arrival_information_email_sent']};
    return (legacy[kind]||[]).some(type=>events.some(event=>event.event_type===type&&
      (kind!=='payment'||Number(event.details?.payment_id)===Number(paymentId))));
  }
  function combinedPaymentMessage(row,paymentId) {
    return (row.timeline||[]).some(event=>event.event_type==='message_sent_manually'&&event.details?.kind==='payment'&&
      Number(event.details?.payment_id)===Number(paymentId)&&event.details?.includes_confirmation&&event.details?.includes_arrival);
  }
  function focusWorkspace(selector) {
    const target=element('record-dialog').querySelector(selector);
    if(!target)return false;
    const folded=target.closest('details');if(folded)folded.open=true;
    target.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
    target.focus({preventScroll:true});
    return true;
  }
  function appendProgress(parent,row,handlers={}) {
    const panel=document.createElement('section');panel.className='progress-panel';
    const heading=document.createElement('div');heading.className='progress-heading';
    text(heading,'h3','Parcours du dossier');
    const pending=[];
    const list=document.createElement('ol');list.className='progress-list';
    const add=(label,done,activate,detail='')=>{
      const item=document.createElement('li');
      const action=text(item,done?'div':'button','',`progress-step ${done?'is-complete':'is-pending'}`);if(!done)action.type='button';
      const dot=document.createElement('span');dot.className='progress-dot';dot.setAttribute('aria-hidden','true');
      const copy=document.createElement('span');copy.className='progress-copy';text(copy,'strong',label);if(detail)text(copy,'small',detail);
      const state=text(action,'span',done?'Fait':'À venir','progress-state');action.append(dot,copy,state);if(!done)pending.push({label,activate,action,state});
      if(!done){action.addEventListener('click',async()=>{action.disabled=true;const feedback=element('record-action-feedback');if(feedback)feedback.hidden=true;try{await activate()}catch(error){reportActionError(error)}finally{action.disabled=false}});action.setAttribute('aria-label',label+', à faire. Lancer cette étape.')}item.append(action);list.append(item);
    };
    if(row.source==='direct'){
      const quoteSent=sentMessage(row,'quote'),hasPayments=(row.payments||[]).length>0;
      if(row.package||row.has_quote){
        add(quoteSent?'Devis envoyé':hasPayments?'Devis clôturé':'Devis à préparer',quoteSent||hasPayments,
          ()=>{if(!quoteSent&&!hasPayments)prepare(row,'quote');else focusWorkspace('#quote-action')},
          quoteSent?'Copie confirmée dans votre messagerie':hasPayments?'Un paiement est déjà enregistré':'Préparez puis envoyez votre proposition');
      }
      if(row.has_quote){
        const fullyPaid=Number(row.balance_cents||0)<=0;
        const payments=row.payments||[];
        const settlementEvent=(row.timeline||[]).find(event=>event.event_type==='payment_validated'&&
          (event.details?.fully_paid||Number(event.details?.balance_cents)===0));
        const settlementPayment=settlementEvent?payments.find(payment=>Number(payment.id)===Number(settlementEvent.details?.payment_id)):null;
        const combinedEmail=fullyPaid&&row.status==='confirmed'&&settlementPayment;
        payments.filter(payment=>!combinedEmail||Number(payment.id)!==Number(settlementPayment.id)).forEach(payment=>{
          const receiptSent=payment.message_sent||sentMessage(row,'payment',payment.id);
          add(receiptSent?'Courriel de paiement envoyé':'Courriel de paiement à envoyer',receiptSent,
            ()=>prepare(row,'payment',payment.id),money(payment.amount_cents)+' · '+dateLabel(String(payment.verified_at).slice(0,10)));
        });
        add(fullyPaid?'Paiement intégral reçu':Number(row.paid_cents||0)>0?'Solde à enregistrer':'Acompte à enregistrer',fullyPaid,
          ()=>focusWorkspace('#payment-amount'),fullyPaid?'Règlement complet saisi':(row.payment_plan&&!fullyPaid&&Number(row.paid_cents||0)>0?'À recevoir avant le '+dateLabel(row.payment_plan.balance_due):'À rapprocher avec le relevé bancaire'));
        const confirmationSent=(row.timeline||[]).some(event=>['reservation_confirmation_sent_manually','reservation_confirmation_email_sent'].includes(event.event_type));
        const arrivalSent=(row.timeline||[]).some(event=>['arrival_information_sent_manually','arrival_information_email_sent'].includes(event.event_type));
        if(combinedEmail){
          const paymentEmailSent=(settlementPayment.message_sent||sentMessage(row,'payment',settlementPayment.id))&&confirmationSent&&arrivalSent;
          add(paymentEmailSent?'Confirmation de paiement et réservation envoyée':'Confirmation de paiement et réservation à envoyer',paymentEmailSent,
            ()=>prepare(row,'payment',settlementPayment.id),paymentEmailSent?'Un seul courriel confirmé':'Un seul courriel regroupe paiement, réservation et arrivée');
        }
        if(row.status==='confirmed'){
          if(!combinedEmail){
            const confirmationAndArrivalSent=confirmationSent&&arrivalSent;
            add(confirmationAndArrivalSent?'Confirmation et informations d’arrivée envoyées':'Confirmation et informations d’arrivée à envoyer',confirmationAndArrivalSent,
              ()=>prepare(row,'arrival'),confirmationAndArrivalSent?'Un seul courriel confirmé':'Préparez le message de confirmation et d’arrivée');
          }
          [['reception_ready','Accueil à préparer','Accueil préparé','Cliquez quand la maison est prête'],['cleaning_done','Ménage à valider','Ménage validé','Cliquez une fois le ménage terminé']].forEach(([key,label,doneLabel,hint])=>{
            const complete=Boolean(row.checklist?.[key]);
            add(complete?doneLabel:label,complete,()=>setFlag(row,key),complete?'':hint);
          });
        }
      }
    } else {
      if(row.status==='pending')add('Dates à valider',false,handlers.confirm||(()=>{if(!focusWorkspace('#record-conflict'))editInquiry(row)}),row.conflict?'Ces dates chevauchent une autre réservation':'Vérifiez puis bloquez les dates');
      if(row.status==='confirmed'){
        [['reception_ready','Accueil à préparer','Accueil préparé','Cliquez quand la maison est prête'],['cleaning_done','Ménage à valider','Ménage validé','Cliquez une fois le ménage terminé']].forEach(([key,label,doneLabel,hint])=>{
          const complete=Boolean(row.checklist?.[key]);
          add(complete?doneLabel:label,complete,()=>setFlag(row,key),complete?'':hint);
        });
      }
    }
    if(!list.children.length)text(panel,'p','Aucune étape à suivre pour ce dossier.','progress-empty');
    else panel.append(heading,list);
    if(pending[0]){pending[0].action.classList.add('is-next');pending[0].state.textContent='Maintenant'}
    parent.append(panel);
    return pending[0]||null;
  }
  // Coche une étape (accueil, ménage) en un clic, sans formulaire à enregistrer.
  async function setFlag(row,key){
    const payload=workflowPayload(row);payload.checklist[key]=true;
    await api('requests/'+row.id+'/workflow',payload);await refresh();
    const updated=current.records.find(record=>record.id===row.id);if(updated)showRecord(updated);
    notice(key==='cleaning_done'?'Ménage validé.':'Accueil préparé.');
  }
  const eventLabels={history_tracking_started:'Suivi chronologique activé',request_received:'Demande reçue sur le site',reservation_confirmed:'Réservation confirmée',reservation_cancelled:'Réservation annulée',request_rejected:'Demande refusée',external_reservation_received:'Réservation externe enregistrée',external_reservation_updated:'Dossier externe modifié',external_dates_validated:'Dates validées',payment_validated:'Paiement validé',quote_email_sent:'Devis envoyé par e-mail',quote_marked_sent_manually:'Devis envoyé après copie',followup_email_sent:'Relance envoyée par e-mail',followup_marked_sent_manually:'Relance envoyée après copie',payment_email_sent:'Confirmation de paiement envoyée',reservation_confirmation_email_sent:'Confirmation de réservation envoyée',arrival_information_email_sent:'Informations d’arrivée envoyées',reservation_confirmation_sent_manually:'Confirmation de réservation envoyée après copie',arrival_information_sent_manually:'Informations d’arrivée envoyées après copie',email_send_failed:'Échec de l’envoi du courriel',message_prepared:'Brouillon préparé',message_sent_manually:'Message envoyé après copie',checklist_step_updated:'Étape du séjour mise à jour',private_note_updated:'Note privée modifiée',cleaning_instructions_updated:'Consignes ménage modifiées',cleaning_team_notified:'Demande transmise à l’équipe ménage',cleaning_request_received:'Demande de ménage reçue par l’équipe',cleaning_completed_by_team:'Ménage terminé — équipe',arrival_time_updated:'Heure d’arrivée actualisée',departure_time_updated:'Heure de départ actualisée'};
  function appendTimeline(parent,row) {
    const section=document.createElement('section');section.className='event-timeline';text(section,'h3','Historique du dossier');
    const list=document.createElement('ol');
    [...(row.timeline||[])].reverse().forEach(event=>{
      if(event.event_type==='message_prepared'&&sentMessage(row,event.details?.kind,event.details?.payment_id))return;
      if(['reservation_confirmation_sent_manually','arrival_information_sent_manually'].includes(event.event_type)&&combinedPaymentMessage(row,event.details?.payment_id))return;
      const item=document.createElement('li');item.className=event.event_type==='email_send_failed'?'timeline-error':'';
      const head=document.createElement('div');head.className='timeline-head';
      let when=event.created_at;try{when=new Intl.DateTimeFormat('fr-BE',{dateStyle:'medium',timeStyle:'short'}).format(new Date(event.created_at))}catch{}
      const detail=event.details||{};let description='';
      const messageNames={quote:'Devis',followup:'Relance',payment:'Courriel de paiement',arrival:'Informations d’arrivée',unavailable:'Réponse d’indisponibilité',rejection:'Réponse de refus',cancellation:'Confirmation d’annulation'};
      const title=event.event_type==='message_prepared'?(messageNames[detail.kind]||'Message')+' à envoyer':event.event_type==='message_sent_manually'&&detail.kind==='payment'&&detail.includes_confirmation&&detail.includes_arrival?'Courriel unique : paiement, réservation et arrivée envoyé':event.event_type==='message_sent_manually'?(messageNames[detail.kind]||'Message')+' envoyé':event.event_type==='email_send_failed'?'Ancien essai automatique non envoyé — mode manuel actif':eventLabels[event.event_type]||event.event_type.replaceAll('_',' ');
      text(head,'strong',title);text(head,'time',when);
      if(event.event_type==='history_tracking_started')description='L’historique antérieur n’est pas disponible. Statut actuel : '+(statuses[detail.existing_status]||detail.existing_status||'inconnu')+'.';
      else if(event.event_type==='payment_validated')description=money(detail.amount_cents)+' · '+({transfer:'Virement bancaire',card:'Carte',cash:'Espèces',other:'Autre'}[detail.method]||'')+(detail.reference?' · Réf. '+detail.reference:'')+(detail.fully_paid?' · Solde réglé':' · Reste '+money(detail.balance_cents));
      else if(event.event_type==='email_send_failed')description=detail.reason||'Le message n’a pas été envoyé.';
      else if(event.event_type==='quote_email_sent'||event.event_type==='quote_marked_sent_manually'||event.event_type==='followup_email_sent'||event.event_type==='followup_marked_sent_manually'||event.event_type==='payment_email_sent'||event.event_type==='reservation_confirmation_email_sent'||event.event_type==='arrival_information_email_sent'||event.event_type==='reservation_confirmation_sent_manually'||event.event_type==='arrival_information_sent_manually'||event.event_type==='message_sent_manually')description=detail.recipient||'';
      else if(event.event_type==='message_prepared'&&detail.kind==='followup')description=detail.subject||'';
      else if(event.event_type==='checklist_step_updated')description=(directFlags[detail.step]||externalFlags[detail.step]||detail.step)+': '+(detail.completed?'terminé':'à refaire');
      else if(event.event_type==='cleaning_team_notified')description='Départ du '+(detail.departure?dateLabel(detail.departure):'séjour')+' · '+({whatsapp:'WhatsApp',share:'menu de partage',copy:'copie manuelle'}[detail.channel]||'canal non précisé')+'. Transmission déclarée par vous.';
      else if(event.event_type==='cleaning_request_received'||event.event_type==='cleaning_completed_by_team')description='Départ concerné : '+(detail.departure?dateLabel(detail.departure):'date à vérifier')+'.';
      else if(event.event_type==='arrival_time_updated'||event.event_type==='departure_time_updated')description=(detail.from||'—')+' → '+(detail.to||'—')+'.';
      else if(detail.arrival)description=dateLabel(detail.arrival)+' → '+dateLabel(detail.departure)+(detail.source?' · '+(sources[detail.source]||detail.source):'');
      if(detail.by)description=(description?description+' ':'')+'Par '+detail.by+'.';
      if(description)text(item,'p',description);item.prepend(head);list.append(item);
    });
    if(!list.children.length)text(section,'p','Aucune étape enregistrée pour le moment.');else section.append(list);
    parent.append(section);
  }
  function appendPayments(parent,row) {
    const panel=document.createElement('section');panel.className='payment-panel';text(panel,'h3','Paiements');
    const plan=row.payment_plan;
    if(plan){
      const schedule=document.createElement('dl');schedule.className='payment-schedule';
      const paid=Number(row.paid_cents||0),depositOk=paid>=plan.deposit_cents,fullyPaid=Number(row.balance_cents||0)<=0;
      const late=!fullyPaid&&current.today>plan.balance_due;
      const line=(label,amount,stateLabel,tone)=>{const item=document.createElement('div');item.className='payment-line';text(item,'dt',label);const value=document.createElement('dd');text(value,'strong',money(amount));text(value,'span',stateLabel,'payment-state'+(tone?' is-'+tone:''));item.append(value);schedule.append(item)};
      line('Acompte '+plan.deposit_percent+' %, non remboursable',plan.deposit_cents,depositOk?'Reçu':'En attente',depositOk?'ok':'');
      line('Solde, dû le '+dateLabel(plan.balance_due),Math.max(0,row.total_cents-plan.deposit_cents),fullyPaid?'Reçu':late?'En retard':'À recevoir',fullyPaid?'ok':late?'late':'');
      panel.append(schedule);
    }
    text(panel,'p','Déjà reçu : '+money(row.paid_cents)+'. Reste à recevoir : '+money(row.balance_cents)+'.','payment-summary');
    const list=document.createElement('ul');(row.payments||[]).forEach(payment=>{const item=document.createElement('li');let when=payment.verified_at;try{when=new Intl.DateTimeFormat('fr-BE',{dateStyle:'medium'}).format(new Date(payment.verified_at))}catch{};text(item,'span',money(payment.amount_cents)+' · '+when+' · '+({transfer:'Virement',card:'Carte',cash:'Espèces',other:'Autre'}[payment.method]||payment.method));if(payment.reference)text(item,'span','Réf. '+payment.reference);if(!payment.message_sent&&!sentMessage(row,'payment',payment.id))button(item,'Préparer le courriel',()=>prepare(row,'payment',payment.id),'btn btn-outline');list.append(item)});if(list.children.length)panel.append(list);
    if(row.has_quote&&row.email&&row.status!=='cancelled'&&row.status!=='rejected'&&row.balance_cents>0){
      const fold=document.createElement('details');fold.className='payment-fold';text(fold,'summary','Enregistrer un paiement reçu');
      const form=document.createElement('form');form.className='payment-form';form.id='payment-form';const fields=document.createElement('div');fields.className='payment-fields';
      const amountLabel=text(fields,'label','Montant reçu (€)'),amount=document.createElement('input');amount.id='payment-amount';amount.type='number';amount.min='0.01';amount.max=(row.balance_cents/100).toFixed(2);amount.step='0.01';amount.required=true;amount.inputMode='decimal';amountLabel.append(amount);
      const methodLabel=text(fields,'label','Mode de paiement'),method=document.createElement('select');[['transfer','Virement bancaire'],['card','Carte'],['cash','Espèces'],['other','Autre']].forEach(([value,label])=>{const option=document.createElement('option');option.value=value;option.textContent=label;method.append(option)});methodLabel.append(method);
      const refLabel=text(fields,'label','Référence (facultatif)'),reference=document.createElement('input');reference.maxLength=150;refLabel.append(reference);fields.append(amountLabel,methodLabel,refLabel);form.append(fields);
      const save=text(form,'button','Valider le paiement');save.type='submit';save.className='btn';const status=text(form,'p','Après validation, le message de confirmation est préparé pour être copié dans votre messagerie.');status.setAttribute('role','status');form.append(save,status);
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(!amount.reportValidity())return;save.disabled=true;
        let result;
        try{result=await api('requests/'+row.id+'/payment',{amount:amount.value,method:method.value,reference:reference.value,version:row.version})}
        catch(error){status.textContent='Paiement non enregistré : '+error.message;save.disabled=false;return}
        status.textContent='Paiement enregistré. Actualisation du dossier…';
        try{await refresh()}catch(error){status.textContent='Paiement enregistré, mais l’affichage n’a pas pu être actualisé. Cliquez sur Actualiser avant toute nouvelle saisie.';notice(error.message);save.disabled=false;return}
        const updated=current.records.find(record=>record.id===row.id);
        if(updated){showRecord(updated);if(result.email_draft)displayDraft(updated,'payment',result.email_draft,result.payment_id)}
        if(result.email_draft_error)notice('Paiement enregistré. Le brouillon n’a pas été préparé : '+result.email_draft_error+' Vous pourrez le préparer depuis le dossier.');
        else notice(result.reservation_confirmed?'Paiement validé et réservation confirmée. Le courriel est prêt à copier.':'Paiement enregistré. Le courriel est prêt à copier.');
        save.disabled=false;
      });
      fold.append(form);panel.append(fold);
    }
    parent.append(panel);
  }
  function cleaningMessage(row,task) {
    const incoming=task.next_arrival?current.records.find(item=>item.id===task.next_arrival):null;
    const lines=['LE NOYER — PASSAGE MÉNAGE','Date : '+dateInput(task.date),'Créneau de préparation : '+(row.departure_time||'09:00').replace(':',' h ')+' à 17 h',
      'Séjour sortant : '+(row.name||sources[row.source]||'Voyageurs')+' · '+row.guests+' personnes'];
    lines.push(incoming?(incoming.arrival===task.date?'Nouvelle arrivée le même jour : ':'Prochaine arrivée le '+dateInput(incoming.arrival)+' : ')+(incoming.name||sources[incoming.source]||'Voyageurs')+' · '+incoming.guests+' personnes, à partir de '+(incoming.arrival_time||'17:00').replace(':',' h ')+'.':'Aucune prochaine arrivée enregistrée.');
    lines.push('Adresse : Rue Bierleux 69A, 4990 Lierneux.','Consignes : '+(row.cleaning_note||'Aucune consigne particulière.'),'Après réception, confirmez la demande et la fin du ménage dans l’espace équipe : '+window.location.origin+'/equipe-menage');
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
    const titles={dashboard:'Vue d’ensemble',dossiers:'Dossiers',members:'Membres',reservations:'Réservations externes','site-requests':'Demandes du site',cleaning:'Accueil & ménage',pricing:'Tarifs du site',availability:'Disponibilités'};
    if(!titles[page])page='dashboard';
    const changed=activePage!==page;activePage=page;
    document.querySelectorAll('[data-erp-page]').forEach(panel=>{panel.hidden=panel.dataset.erpPage!==page});
    document.querySelectorAll('[data-erp-nav]').forEach(link=>{if(link.dataset.erpNav===page)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current')});
    element('year').hidden=page==='cleaning';element('year').labels[0].hidden=page==='cleaning';
    element('page-title').textContent=titles[page];
    document.title=titles[page]+' — Le Noyer';
    element('erp-sidebar').classList.remove('is-open');element('mobile-menu').setAttribute('aria-expanded','false');
    if(changed){window.scrollTo({top:0,behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});element('page-title').focus({preventScroll:true})}
    if(updateUrl&&location.hash!=='#'+page)history.pushState(null,'','#'+page);
    if(page==='members')renderMembers().catch(error=>notice(error.message));
  }
  function showRecord(row) {
    if(activePage!=='dossiers')showPage(row.source==='direct'?'site-requests':'reservations',true);
    const dialog=element('record-dialog'),content=element('record-content');content.replaceChildren();
    const actionFeedback=text(content,'p','');actionFeedback.id='record-action-feedback';actionFeedback.className='workspace-warning';actionFeedback.setAttribute('role','alert');actionFeedback.hidden=true;
    element('record-title').textContent=row.name||sources[row.source]||'Séjour';
    const eyebrow=dialog.querySelector('.dialog-head .erp-eyebrow');if(eyebrow)eyebrow.textContent='Dossier n° '+row.id;
    content.className='record-workspace';
    const direct=row.source==='direct';
    const nights=Math.round((new Date(row.departure+'T12:00:00')-new Date(row.arrival+'T12:00:00'))/86400000);
    const hour=value=>{const [h,m]=(value||'').slice(0,5).split(':');return Number(h)+' h'+(m&&m!=='00'?' '+m:'')};

    // En-tête : état, origine, alerte éventuelle, puis les informations clés présentées de la même façon pour tous les dossiers.
    const head=document.createElement('div');head.className='record-head';
    const chips=document.createElement('div');chips.className='record-chips';
    text(chips,'span',statusLabel(row),'record-status status-'+row.status);
    text(chips,'span',direct?'Site Le Noyer':sources[row.source]||'Autre','record-chip');
    if(row.conflict)text(chips,'span','Dates en conflit','record-status status-conflict');
    head.append(chips);
    const summary=document.createElement('dl');summary.className='record-summary-grid';
    const facts=[['Séjour',dateLabel(row.arrival)+' → '+dateLabel(row.departure)+', '+nights+' nuit'+(nights>1?'s':'')],
      ['Horaires','Arrivée '+hour(row.arrival_time||'17:00')+', départ '+hour(row.departure_time||'09:00')],
      ['Voyageurs',row.guests+' personnes']];
    if(direct)facts.push(['Montant',money(row.total_cents)],['E-mail',row.email||'À compléter']);
    else facts.push(['Référence',row.reference||'Non renseignée'],['Contact',row.email||'Non renseigné']);
    facts.forEach(([label,value])=>{const item=document.createElement('div');item.className='record-fact';text(item,'dt',label);text(item,'dd',value);summary.append(item)});
    head.append(summary);content.append(head);

    const grid=document.createElement('div');grid.className='record-workspace-grid';
    const reading=document.createElement('div');reading.className='record-reading';
    const aside=document.createElement('aside');aside.className='record-control';

    // Valider ou confirmer les dates : utilisé par la prochaine action et par le parcours.
    const canConfirm=row.status==='pending'&&row.confirmable&&!row.conflict;
    const confirmDates=canConfirm?async()=>{
      await api('requests/'+row.id+'/status',{status:'confirmed'});
      try{await refresh()}catch(error){reportActionError(new Error('Réservation confirmée, mais l’affichage n’a pas pu être actualisé. Cliquez sur Actualiser. '+error.message));return}
      const updated=current.records.find(record=>record.id===row.id);
      if(updated){showRecord(updated);if(direct){try{await prepare(updated,'arrival')}catch(error){reportActionError(new Error('Réservation confirmée. Le courriel d’arrivée n’a pas été préparé : '+error.message));return}}}
      notice(direct?'Réservation confirmée. Le courriel d’arrivée est prêt à copier.':'Dates validées et bloquées dans le calendrier.');
    }:null;

    // Parcours (colonne de droite) : une seule liste d'étapes, chacune lance sa propre action.
    const next=appendProgress(aside,row,{confirm:confirmDates});

    // Prochaine action : la seule action principale de la fiche.
    const state=dossierState(row);
    const nextCard=document.createElement('section');nextCard.className='record-next';
    if(state){
      const top=document.createElement('div');top.className='record-next-top';
      text(top,'span','Prochaine action','record-next-label');text(top,'span',state.progress+' % du parcours','record-next-progress');nextCard.append(top);
      const bar=document.createElement('span');bar.className='dossier-bar';const fill=document.createElement('i');fill.style.width=state.progress+'%';bar.append(fill);nextCard.append(bar);
      text(nextCard,'strong',next?next.label:state.next,'record-next-title');
      // L'échéance n'est affichée que si elle concerne bien l'étape proposée.
      const sameStep=!next||next.label===state.next||(/Solde|Acompte/.test(next.label)&&/Solde|acompte/.test(state.next));
      if(state.due&&sameStep)text(nextCard,'p',(state.tone==='late'?'En retard : ':'Échéance : ')+dueText(state),'record-next-due'+(state.tone?' is-'+state.tone:''));
      else if(next)text(nextCard,'p','À faire dès maintenant.','record-next-due');
      if(next){
        const verb=/Courriel|courriel|message|Confirmation|Devis|devis/.test(next.label)?'Préparer le message':/Solde|Acompte|Paiement/.test(next.label)?'Enregistrer le paiement':/Dates/.test(next.label)?'Valider les dates':'Marquer comme fait';
        const go=button(nextCard,verb,next.activate,'btn');go.id=row.status==='pending'&&!direct?'record-confirm-dates':'record-next-action';
      }
    } else {
      text(nextCard,'span','Dossier','record-next-label');
      text(nextCard,'strong',row.status==='cancelled'?'Réservation annulée':row.status==='rejected'?'Demande refusée':'Dossier terminé','record-next-title');
    }
    reading.append(nextCard);

    if(row.conflict){const warning=text(reading,'p','Ces dates chevauchent une autre réservation ou un blocage. Vérifiez le calendrier avant de valider.','workspace-warning record-alert');warning.id='record-conflict'}
    if(row.message){const original=document.createElement('details');original.className='record-source-message';text(original,'summary',direct?'Message du client':'Note de la plateforme');text(original,'p',row.message,'original-message');reading.append(original)}

    // Notes : privées ou destinées à l'équipe ménage, enregistrées à part.
    const form=document.createElement('form');form.className='record-followup';form.id='workflow-form';text(form,'h3','Notes');
    const noteLabel=document.createElement('label');noteLabel.textContent='Note privée';const notes=document.createElement('textarea');notes.name='notes';notes.rows=3;notes.maxLength=4000;notes.value=row.notes;notes.placeholder='Visible uniquement dans l’espace propriétaire';noteLabel.append(notes);form.append(noteLabel);
    let cleaningNote=null;
    if(row.status==='confirmed'){
      const cleaningLabel=document.createElement('label');cleaningLabel.textContent='Consignes pour l’équipe ménage';cleaningNote=document.createElement('textarea');cleaningNote.name='cleaning_note';cleaningNote.rows=3;cleaningNote.maxLength=2000;cleaningNote.value=row.cleaning_note||'';cleaningNote.placeholder='Ex. attention au poêle, linge à laisser dans le local…';cleaningLabel.append(cleaningNote);form.append(cleaningLabel);
    }
    const save=text(form,'button','Enregistrer les notes');save.type='submit';save.className='btn btn-outline';save.disabled=true;
    const statusText=text(form,'p','','form-hint');statusText.setAttribute('role','status');statusText.setAttribute('aria-live','polite');
    form.addEventListener('input',()=>{save.disabled=false;statusText.textContent='Modifications non enregistrées.'});
    form.addEventListener('submit',async event=>{event.preventDefault();save.disabled=true;try{
      await api('requests/'+row.id+'/workflow',{...workflowPayload(row),notes:notes.value,cleaning_note:cleaningNote?cleaningNote.value:(row.cleaning_note||'')});
      await refresh();const updated=current.records.find(record=>record.id===row.id);if(updated)showRecord(updated);notice('Notes du dossier enregistrées.');
    }catch(error){statusText.textContent=error.message;save.disabled=false}});
    reading.append(form);
    appendTimeline(reading,row);

    // Paiements (dossiers du site).
    if(direct&&row.has_quote)appendPayments(aside,row);

    // Messages ponctuels, non couverts par le parcours.
    if(direct){
      const drafts=document.createElement('section');drafts.className='record-extra';
      const items=[];
      if(row.status==='pending'&&!row.conflict)items.push(['Préparer une relance',()=>prepare(row,'followup')]);
      if(row.conflict)items.push(['Répondre que les dates sont indisponibles',()=>prepare(row,'unavailable')]);
      if(row.status==='rejected')items.push(['Préparer la réponse de refus',()=>prepare(row,'rejection')]);
      if(row.status==='cancelled')items.push(['Préparer la confirmation d’annulation',()=>prepare(row,'cancellation')]);
      if(items.length){text(drafts,'h3','Messages');const box=document.createElement('div');box.className='record-actions';items.forEach(([label,fn])=>button(box,label,fn,'btn btn-outline'));drafts.append(box);aside.append(drafts)}
    }

    // Autres actions : modifications et annulations, volontairement discrètes.
    const others=[];
    if(!direct&&row.status==='pending')others.push(['Modifier les dates ou les informations',()=>editInquiry(row),'record-edit-dates']);
    if(row.status==='pending'&&direct)others.push(['Refuser la demande',async()=>{if(!window.confirm('Refuser cette demande du site ?'))return;await api('requests/'+row.id+'/status',{status:'rejected'});await refresh();const updated=current.records.find(record=>record.id===row.id);if(updated){showRecord(updated);await prepare(updated,'rejection')}}]);
    if(row.status==='confirmed')others.push([direct?'Annuler et libérer les dates':'Retirer du calendrier',async()=>{const message=direct?'Annuler cette réservation et libérer les dates ?':'Confirmez que la réservation a été annulée sur la plateforme avant de libérer les dates ici.';if(!window.confirm(message))return;await api('requests/'+row.id+'/status',{status:'cancelled'});await refresh();const updated=current.records.find(record=>record.id===row.id);if(updated){showRecord(updated);if(direct)await prepare(updated,'cancellation')}}]);
    if(others.length){
      const more=document.createElement('details');more.className='record-more';text(more,'summary','Autres actions');
      const box=document.createElement('div');box.className='record-actions';
      others.forEach(([label,fn,id])=>{const node=button(box,label,fn,'btn btn-muted');if(id)node.id=id});
      more.append(box);aside.append(more);
    }

    grid.append(reading,aside);content.append(grid);
    if(!dialog.open)dialog.showModal();
  }
  function openRecord(identifier) {
    const row=current?.records.find(record=>record.id===identifier);
    if(row)showRecord(row);
  }
  function workflowPayload(row) {return {version:row.version,notes:row.notes,cleaning_note:row.cleaning_note||'',arrival_time:row.arrival_time||'17:00',departure_time:row.departure_time||'09:00',checklist:{...row.checklist}}}
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
      const hours=document.createElement('form');hours.className='operation-hours';
      [['Heure d’arrivée annoncée','arrival_time',row.arrival_time||'17:00'],['Heure de départ','departure_time',row.departure_time||'09:00']].forEach(([label,key,value])=>{const field=document.createElement('label');text(field,'span',label);const input=document.createElement('input');input.type='time';input.name=key;input.value=value;field.append(input);hours.append(field)});
      const saveHours=text(hours,'button','Enregistrer les horaires');saveHours.type='submit';saveHours.className='btn btn-outline';
      hours.addEventListener('submit',async event=>{event.preventDefault();saveHours.disabled=true;try{const payload=workflowPayload(row);payload.arrival_time=hours.elements.namedItem('arrival_time').value;payload.departure_time=hours.elements.namedItem('departure_time').value;await api('requests/'+row.id+'/workflow',payload);await refresh();notice('Horaires enregistrés pour le voyageur et l’équipe ménage.')}catch(error){notice(error.message)}finally{saveHours.disabled=false}});
      card.append(hours);
      const ready=Boolean(row.checklist.reception_ready);text(card,'span',ready?'Accueil prêt':'À préparer','record-status '+(ready?'status-confirmed':'status-pending'));
      const actions=document.createElement('div');actions.className='operation-actions';
      button(actions,ready?'Voir le séjour':'Préparer l’accueil',()=>showRecord(row),'btn btn-outline');card.append(actions);parent.append(card);
    });
  }
  function renderCleaning() {
    const parent=element('cleaning-list');parent.replaceChildren();
    const filter=element('cleaning-status').value;
    const tasks=current.cleaning.filter(task=>{
      if(filter==='all')return true;
      if(filter==='transmit')return !task.done&&!task.requested;
      if(filter==='receipt')return !task.done&&task.requested&&!task.received;
      if(filter==='clean')return !task.done&&task.requested&&task.received;
      if(filter==='done')return task.done;
      return !task.done;
    }).sort((first,second)=>first.date.localeCompare(second.date));
    if(!tasks.length){const empty=document.createElement('div');empty.className='empty-state';text(empty,'strong','Aucune réservation dans cette étape.');text(empty,'p','Choisissez une autre étape dans la liste de suivi.');parent.append(empty);return}
    tasks.forEach(task=>{const row=current.records.find(record=>record.id===task.booking_id);if(!row)return;
      const card=document.createElement('article');card.className='operation-row';
      const date=document.createElement('div');date.className='operation-date';text(date,'strong',dateLabel(task.date));text(date,'span','9 h–17 h');card.append(date);
      const info=document.createElement('div');text(info,'strong','Départ · '+(row.name||sources[row.source]));text(info,'span',task.same_day_arrival?'Nouvelle arrivée le même jour':'Maison à préparer pour le prochain séjour');card.append(info);
      text(card,'span',task.done?'Ménage terminé':task.received?'Demande reçue':task.requested?'En attente de confirmation':'Demande à transmettre','record-status '+(task.done?'status-confirmed':'status-pending'));
      const actions=document.createElement('div');actions.className='operation-actions';
      button(actions,'Partager les consignes',()=>openCleaningShare(row,task),'btn btn-outline');
      button(actions,task.done?'Annuler la validation':'Marquer la maison prête',async()=>{const payload=workflowPayload(row);payload.checklist.cleaning_done=!task.done;await api('requests/'+row.id+'/workflow',payload);await refresh()},'btn btn-outline');
      button(actions,'Ouvrir la fiche',()=>showRecord(row),'task-open');card.append(actions);parent.append(card);
    });
  }
  function fillRate(rate) {
    showPage('pricing',true);
    const form=element('rate-form');form.reset();
    Object.entries({id:0,label:rate.label+' (copie)',start:rate.start,end:rate.end,midweek:(rate.midweek_cents/100).toFixed(2),weekend:(rate.weekend_cents/100).toFixed(2),cleaning:(rate.cleaning_cents/100).toFixed(2),charges:((rate.charges_cents||0)/100).toFixed(2)}).forEach(([key,value])=>form.elements.namedItem(key).value=value);
    form.scrollIntoView({block:'start'});form.elements.namedItem('start').focus();notice('Prix copiés. Choisissez une nouvelle période sans chevauchement, puis enregistrez.');
  }
  function renderRates() {
    const parent=element('rates');parent.replaceChildren();
    if(!currentRates.length){const empty=document.createElement('div');empty.className='empty-state';text(empty,'strong','Aucune période tarifaire.');text(empty,'p','Ajoute une première saison avec le formulaire.');parent.append(empty);return}
    const table=document.createElement('table');table.className='rates-table';const head=document.createElement('thead'),header=document.createElement('tr');
    ['Choisir','Période d’arrivée','Mid-week (€)','Week-end (€)','Ménage (€)','Charges / séjour (€)','Actions'].forEach(label=>{const cell=text(header,'th',label);cell.scope='col'});head.append(header);table.append(head);const body=document.createElement('tbody');
    currentRates.forEach(rate=>{const row=document.createElement('tr'),selectCell=document.createElement('td'),select=document.createElement('input');select.type='checkbox';select.checked=selectedRates.has(rate.id);select.setAttribute('aria-label','Sélectionner '+rate.label);select.addEventListener('change',()=>{if(select.checked)selectedRates.add(rate.id);else selectedRates.delete(rate.id)});selectCell.append(select);row.append(selectCell);
      text(row,'td',rate.label+' · '+dateLabel(rate.start)+' au '+dateLabel(rate.end)+' (fin exclue)');const inputs={};
      ['midweek','weekend','cleaning','charges'].forEach(key=>{const cell=document.createElement('td'),input=document.createElement('input');input.type='number';input.min=['cleaning','charges'].includes(key)?'0':'0.01';input.max='100000';input.step='0.01';input.required=true;input.value=((rate[key+'_cents']||0)/100).toFixed(2);input.setAttribute('aria-label',rate.label+' '+key+' en euros');inputs[key]=input;cell.append(input);row.append(cell)});
      const actions=document.createElement('td');
      button(actions,'Enregistrer',async()=>{if(!Object.values(inputs).every(input=>input.reportValidity()))return;await api('rates',{id:rate.id,label:rate.label,start:rate.start,end:rate.end,...Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value]))});await refresh();notice('Tarif enregistré.')},'table-action');
      button(actions,'Copier la saison',()=>fillRate(rate),'table-action');button(actions,'Désactiver',async()=>{if(!window.confirm('Désactiver cette période tarifaire ?'))return;await api('rates/'+rate.id+'/deactivate',{});await refresh()},'table-action');row.append(actions);body.append(row);
    });table.append(body);parent.append(table);
  }
  // Dossiers : étape, progression et prochaine échéance de chaque séjour.
  const addDays=(value,days)=>{const d=new Date(value+'T12:00:00');d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)};
  const timelineHas=(row,types)=>(row.timeline||[]).some(event=>types.includes(event.event_type));
  function dossierState(row) {
    const today=current.today,rules=current.settings||{deposit_percent:30,balance_days:45,quote_hours:24,access_days:7};
    if(!['pending','confirmed'].includes(row.status))return null;
    const cleaned=Boolean(row.checklist?.cleaning_done),started=row.arrival<=today;
    if(row.departure<today&&(cleaned||row.status!=='confirmed'))return null;
    const created=String(row.created_at||today).slice(0,10);
    const replyDue=addDays(created,Math.ceil((rules.quote_hours||24)/24));
    const steps=[],next={};
    const set=(label,due,tone)=>{if(!next.label){next.label=label;next.due=due||null;next.tone=tone||null}};
    let stage;
    if(row.source!=='direct'){
      steps.push(true,row.status==='confirmed',Boolean(row.checklist?.reception_ready),cleaned);
      if(row.status==='pending'){stage='new';set('Valider les dates',replyDue)}
      else if(!started){stage='before';if(!row.checklist?.reception_ready)set('Préparer l’accueil',addDays(row.arrival,-1));else set('Prêt pour l’arrivée')}
      else{stage='stay';set('Valider le ménage',row.departure)}
    } else {
      const quoteSent=(row.timeline||[]).some(event=>event.event_type==='message_sent_manually'&&event.details?.kind==='quote')||timelineHas(row,['quote_marked_sent_manually','quote_email_sent']);
      const plan=row.payment_plan,paid=Number(row.paid_cents||0),deposit=plan?plan.deposit_cents:0;
      const depositOk=row.status==='confirmed'||(plan&&paid>=deposit);
      const fullyPaid=row.has_quote&&Number(row.balance_cents||0)<=0&&paid>0;
      const infoSent=timelineHas(row,['arrival_information_sent_manually','arrival_information_email_sent']);
      steps.push(true,quoteSent||paid>0,depositOk,fullyPaid,infoSent,Boolean(row.checklist?.reception_ready),cleaned);
      if(row.status==='pending'){
        if(!row.has_quote){stage='new';set('Établir un devis',replyDue)}
        else if(!quoteSent&&!paid){stage='new';set('Envoyer le devis',replyDue)}
        else{stage='quote';set(paid?'Compléter l’acompte ('+money(deposit-paid)+')':'Attendre l’acompte ('+money(deposit)+')')}
      } else if(!fullyPaid&&!started){
        stage='deposit';
        const late=plan&&today>plan.balance_due;
        set(late?'Solde en retard ('+money(row.balance_cents)+'), l’acompte reste acquis':'Solde de '+money(row.balance_cents),plan?.balance_due);
      } else if(!started){
        stage='before';
        if(!infoSent)set('Envoyer les informations d’arrivée',addDays(row.arrival,-(rules.access_days??7)));
        else if(!row.checklist?.reception_ready)set('Préparer l’accueil',addDays(row.arrival,-1));
        else set('Prêt pour l’arrivée');
      } else {stage='stay';set('Valider le ménage',row.departure)}
    }
    const done=steps.filter(Boolean).length;
    const tone=next.due?(next.due<today?'late':next.due<=addDays(today,2)?'soon':''):'';
    return {stage,progress:Math.round(done/steps.length*100),next:next.label,due:next.due,tone};
  }
  const STAGES=[['new','Nouvelle demande','Réponse attendue'],['quote','Devis envoyé','En attente d’acompte'],['deposit','Acompte reçu','Dates bloquées, solde à venir'],['before','Avant l’arrivée','Informations, accueil'],['stay','Séjour et ménage','Jusqu’au ménage validé']];
  function dueText(item){
    if(!item.due)return '';
    const days=daysUntil(item.due);
    if(days<0)return 'en retard de '+(-days)+' j';
    if(days===0)return 'aujourd’hui';
    if(days===1)return 'demain';
    return 'le '+dateLabel(item.due);
  }
  function renderDossiers(){
    const board=element('dossier-board'),actions=element('dossier-actions');if(!board)return;
    board.replaceChildren();actions.replaceChildren();
    const items=current.records.map(row=>({row,state:dossierState(row)})).filter(item=>item.state);
    STAGES.forEach(([key,label,hint])=>{
      const col=document.createElement('section');col.className='dossier-col';
      const list=items.filter(item=>item.state.stage===key).sort((a,b)=>(a.state.due||a.row.arrival).localeCompare(b.state.due||b.row.arrival));
      const head=document.createElement('div');head.className='dossier-col-head';text(head,'h3',label);text(head,'span',String(list.length),'dossier-count');col.append(head);text(col,'p',hint,'dossier-hint');
      if(!list.length)text(col,'p','Aucun dossier.','dossier-empty');
      list.forEach(({row,state})=>{
        const card=document.createElement('button');card.type='button';card.className='dossier-card';
        const top=document.createElement('span');top.className='dossier-top';text(top,'strong',row.name||sources[row.source]);text(top,'span',row.source==='direct'?'Site':sources[row.source],'dossier-src');card.append(top);
        text(card,'span',dateLabel(row.arrival)+' → '+dateLabel(row.departure)+', '+row.guests+' pers.','dossier-meta');
        const bar=document.createElement('span');bar.className='dossier-bar';const fill=document.createElement('i');fill.style.width=state.progress+'%';bar.append(fill);bar.setAttribute('aria-label',state.progress+' % du parcours');card.append(bar);
        const foot=document.createElement('span');foot.className='dossier-foot';
        text(foot,'span',state.next+(state.due?', '+dueText(state):''),'dossier-next'+(state.tone?' is-'+state.tone:''));
        text(foot,'span',row.source==='direct'&&row.total_cents?money(row.total_cents):'Plateforme','dossier-amount');card.append(foot);
        card.addEventListener('click',()=>showRecord(row));
        col.append(card);
      });
      board.append(col);
    });
    const urgent=items.filter(item=>item.state.due&&item.state.due<=addDays(current.today,2)).sort((a,b)=>a.state.due.localeCompare(b.state.due));
    if(!urgent.length)text(actions,'p','Rien d’urgent : aucune échéance dans les deux prochains jours.','dossier-calm');
    urgent.slice(0,6).forEach(({row,state})=>{
      const act=document.createElement('button');act.type='button';act.className='dossier-action is-'+(state.tone||'soon');
      text(act,'strong',state.next);text(act,'span',(row.name||sources[row.source])+', '+dueText(state));
      act.addEventListener('click',()=>showRecord(row));actions.append(act);
    });
    return urgent.length;
  }
  function renderSettings(){
    const form=element('settings-form');if(!form||!current.settings||form.dataset.dirty==='true')return;
    Object.entries(current.settings).forEach(([key,value])=>{const input=form.elements.namedItem(key);if(input)input.value=value});
  }
  // Membres : comptes personnels avec code à 6 chiffres choisi par chacun.
  function invitationMessage(name,link){
    return 'Bonjour '+name+',\n\nVoici votre accès au Noyer. Ouvrez ce lien et choisissez votre code personnel à 6 chiffres (valable 48 h, une seule fois) :\n'+link+'\n\nEnsuite, connectez-vous avec votre prénom et ce code.';
  }
  function showInvitation(result){
    const box=element('invitation-box');box.replaceChildren();box.hidden=false;
    const link=location.origin+'/invitation#'+encodeURIComponent(result.invitation);
    text(box,'h3','Invitation pour '+result.name);
    text(box,'p','À envoyer vous-même (WhatsApp, SMS ou e-mail). Le lien est valable 48 h et ne sert qu’une fois. Il ne sera plus affiché ensuite.');
    const area=document.createElement('textarea');area.rows=6;area.readOnly=true;area.value=invitationMessage(result.name,link);box.append(area);
    const actions=document.createElement('div');actions.className='record-actions';box.append(actions);
    button(actions,'Copier le message',async()=>{try{await navigator.clipboard.writeText(area.value);notice('Message d’invitation copié.')}catch{area.focus();area.select();notice('Copie automatique indisponible : le texte est sélectionné.')}},'btn');
    button(actions,'Ouvrir WhatsApp',()=>{window.open('https://wa.me/?text='+encodeURIComponent(area.value),'_blank','noopener')},'btn btn-outline');
  }
  async function renderMembers(){
    const list=element('members-list');if(!list)return;
    const data=await api('members');list.replaceChildren();
    const me=window.NoyerAccount;
    element('my-account').textContent=me?'Connecté en tant que '+me.name+' ('+me.role_label+'). Changez votre code quand vous le souhaitez.':'Connecté avec la clé de secours : créez votre propre compte propriétaire, puis connectez-vous avec votre prénom et votre code.';
    element('pin-form').hidden=!me;
    if(!data.members.length){const empty=document.createElement('div');empty.className='empty-state';text(empty,'strong','Aucun membre pour l’instant.');text(empty,'p','Commencez par créer votre propre compte propriétaire, puis ceux de l’équipe ménage.');list.append(empty);return}
    data.members.forEach(member=>{
      const row=document.createElement('article');row.className='member-row'+(member.active?'':' is-off');
      const who=document.createElement('div');text(who,'strong',member.name);text(who,'span',data.roles[member.role]+(me&&me.id===member.id?', vous':''),'member-role');row.append(who);
      const state=member.active?(member.has_pin?(member.locked_until&&member.locked_until>new Date().toISOString().slice(0,19)?'Bloqué 15 min':'Actif'):'Invitation en attente'):'Désactivé';
      text(row,'span',state,'record-status '+(state==='Actif'?'status-confirmed':state==='Désactivé'?'status-cancelled':'status-pending'));
      const last=document.createElement('span');last.className='member-meta';last.textContent=member.last_login_at?'Dernière connexion : '+dateLabel(member.last_login_at.slice(0,10))+(member.sessions?', '+member.sessions+' appareil'+(member.sessions>1?'s':''):''):'Jamais connecté';row.append(last);
      const actions=document.createElement('div');actions.className='member-actions';row.append(actions);
      button(actions,member.has_pin?'Nouveau code':'Renvoyer l’invitation',async()=>{const result=await api('members/'+member.id+'/invite',{});showInvitation({...result,name:member.name});await renderMembers()},'btn btn-outline');
      if(member.active&&member.sessions)button(actions,'Déconnecter partout',async()=>{await api('members/'+member.id+'/signout',{});notice(member.name+' est déconnecté de tous ses appareils.');await renderMembers()},'btn btn-muted');
      if(member.active&&!(me&&me.id===member.id))button(actions,'Désactiver',async()=>{if(!window.confirm('Désactiver '+member.name+' ? Son accès est coupé immédiatement.'))return;await api('members/'+member.id+'/deactivate',{});notice(member.name+' est désactivé.');await renderMembers()},'btn btn-muted');
      list.append(row);
    });
  }
  // Compteurs du menu : mêmes règles que le tableau de bord.
  function updateNavCounts(urgentDossiers=0) {
    const future=row=>row.departure>current.today;
    const counts={
      reservations:current.records.filter(row=>future(row)&&((row.source!=='direct'&&row.status==='pending')||row.conflict)).length,
      'site-requests':current.records.filter(row=>future(row)&&row.source==='direct'&&row.status==='pending').length,
      cleaning:(current.cleaning||[]).filter(task=>!task.done).length,
      dossiers:urgentDossiers||0
    };
    document.querySelectorAll('[data-erp-nav]').forEach(link=>{
      let badge=link.querySelector('.nav-count');
      const value=counts[link.dataset.erpNav]||0;
      if(!value){badge?.remove();return}
      if(!badge){badge=document.createElement('span');badge.className='nav-count';link.append(badge)}
      badge.textContent=String(value);
      badge.setAttribute('aria-label',value+' à traiter');
    });
  }
  function render(workspace,state) {
    current=workspace;currentRates=state.rates;
    if(lastYear!==state.year){selectedRates.clear();lastYear=state.year}
    selectedRates=new Set([...selectedRates].filter(id=>currentRates.some(rate=>rate.id===id)));
    renderToday();renderRecordLists();renderReception();renderCleaning();renderRates();
    const urgentDossiers=renderDossiers();renderSettings();
    updateNavCounts(urgentDossiers);
    element('dashboard-date').textContent=dateInput(current.today);
    const missing=state.days.filter(day=>day.date>=current.today&&day.package&&day.state==='unpriced');
    element('rates-warning').textContent=missing.length?missing.length+' dates d’arrivée sans tarif pour '+state.year+'.':'Les dates d’arrivée disponibles ont un tarif pour '+state.year+'.';
  }
  window.NoyerWorkspace={
    connect(client,reload) {
      api=client;refresh=reload;
      element('member-form')?.addEventListener('submit',async event=>{
        event.preventDefault();const form=event.currentTarget;const submit=form.querySelector('button');submit.disabled=true;
        try{const result=await api('members',{name:form.elements.namedItem('name').value,role:form.elements.namedItem('role').value});form.reset();showInvitation(result);await renderMembers()}
        catch(error){notice(error.message)}finally{submit.disabled=false}
      });
      element('pin-form')?.addEventListener('submit',async event=>{
        event.preventDefault();const form=event.currentTarget;
        try{
          const response=await fetch('/api/account/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current:form.elements.namedItem('current').value,new:form.elements.namedItem('new').value})});
          const result=await response.json();if(!response.ok)throw Error(result.error||'Changement impossible.');
          form.reset();notice('Votre code a été changé.');
        }catch(error){notice(error.message)}
      });
      const settingsForm=element('settings-form');
      if(settingsForm){
        settingsForm.addEventListener('input',()=>{settingsForm.dataset.dirty='true'});
        settingsForm.addEventListener('submit',async event=>{
          event.preventDefault();const status=element('settings-status');const submit=settingsForm.querySelector('button[type=submit]');submit.disabled=true;status.textContent='';
          try{
            const data=Object.fromEntries([...new FormData(settingsForm)].map(([key,value])=>[key,Number(value)]));
            await api('settings',data);settingsForm.dataset.dirty='false';await refresh();
            status.textContent='Règles enregistrées.';notice('Règles de paiement enregistrées. Les nouveaux devis et échéances les utilisent.');
          }catch(error){status.textContent=error.message}finally{submit.disabled=false}
        });
      }
      // Les messages d'état deviennent des notifications qui s'effacent seules.
      const status=element('erp-status');let statusTimer=0;
      new MutationObserver(()=>{clearTimeout(statusTimer);if(status.textContent.trim())statusTimer=setTimeout(()=>{status.textContent=''},6000)}).observe(status,{childList:true,characterData:true,subtree:true});
      document.querySelectorAll('[data-erp-nav]').forEach(link=>link.addEventListener('click',()=>showPage(link.dataset.erpNav,true)));
      window.addEventListener('hashchange',()=>showPage(location.hash.slice(1)||'dashboard'));
      ['platform-status','platform-source','site-status'].forEach(id=>element(id).addEventListener('change',renderRecordLists));
      ['platform-search','site-search'].forEach(id=>element(id).addEventListener('input',renderRecordLists));
      element('cleaning-status').addEventListener('change',renderCleaning);
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
      element('mark-message-sent').addEventListener('click',async event=>{
        const control=event.currentTarget;control.disabled=true;
        const kind=control.dataset.kind,paymentId=control.dataset.paymentId,id=Number(control.dataset.bookingId);
        let result;
        try{result=await api('requests/'+id+'/message-sent',{kind,...(paymentId?{payment_id:Number(paymentId)}:{})})}
        catch(error){element('draft-status').textContent='L’envoi n’a pas été inscrit : '+error.message;control.disabled=false;return}
        element('message-draft').close();
        notice(result.sent?(kind==='payment'?'Courriel de paiement marqué comme envoyé et inscrit dans la progression.':'Envoi confirmé et inscrit dans l’historique.'):'L’envoi n’a pas été validé.');
        try{await refresh();const updated=current.records.find(record=>record.id===id);if(updated)showRecord(updated)}
        catch(error){notice('Envoi inscrit dans l’historique, mais l’affichage n’a pas pu être actualisé. Cliquez sur Actualiser. '+error.message)}
        control.disabled=false;
      });
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
