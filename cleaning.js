(() => {
  const $=id=>document.getElementById(id);
  const login=$('login-panel'),planning=$('planning'),tasks=$('tasks'),keyInput=$('clean-key');
  let accessKey='';
  const date=value=>new Intl.DateTimeFormat('fr-BE',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00'));
  const time=value=>value?value.slice(0,5).replace(':',' h '):'—';
  async function request(path,body) {
    const response=await fetch(path,{method:body?'POST':'GET',headers:{...(accessKey?{Authorization:'Bearer '+accessKey}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();if(!response.ok)throw Error(result.error||'La demande n’a pas abouti.');return result;
  }
  function fact(parent,label,value){const item=document.createElement('div');item.className='fact';const title=document.createElement('span');title.textContent=label;const content=document.createElement('strong');content.textContent=value;item.append(title,content);parent.append(item)}
  function matchesFilter(task,filter){
    if(filter==='all')return true;
    if(filter==='transmit')return !task.done&&!task.requested;
    if(filter==='receipt')return !task.done&&task.requested&&!task.received;
    if(filter==='clean')return !task.done&&task.requested&&task.received;
    if(filter==='done')return task.done;
    return !task.done;
  }
  async function refresh(){
    $('plan-status').textContent='Chargement du planning…';
    try{
      const data=await request('/api/cleaning/workspace');tasks.replaceChildren();$('today-label').textContent='Aujourd’hui : '+date(data.today);
      const visibleTasks=data.tasks.filter(task=>matchesFilter(task,$('task-filter').value));
      if(!visibleTasks.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='Aucune réservation dans cette étape. Choisissez une autre étape dans la liste de suivi.';tasks.append(empty)}
      visibleTasks.forEach(task=>{
        const card=document.createElement('article');card.className='task'+(task.done?' done':'');
        const heading=document.createElement('div');heading.className='task-date';const title=document.createElement('strong');title.textContent=date(task.date)+', de '+time(task.checkout_time)+' à 17 h';const badge=document.createElement('span');badge.className='badge'+(task.done?' ok':'');badge.textContent=task.done?'Ménage terminé':task.received?'Demande reçue':task.requested?'À confirmer':'En attente de transmission';heading.append(title,badge);card.append(heading);
        const info=document.createElement('div');info.className='task-info';fact(info,'Séjour sortant',task.guest_name+', '+task.guest_count+' voyageurs');fact(info,'Départ des voyageurs',date(task.departure)+' à '+time(task.checkout_time));card.append(info);
        const next=document.createElement('div');next.className='same-day';next.textContent=task.incoming_arrival?(task.incoming_arrival.date===task.date?'Nouvelle arrivée le même jour':'Prochaine réservation le '+date(task.incoming_arrival.date))+': '+task.incoming_arrival.guest_name+', '+task.incoming_arrival.guest_count+' voyageurs, arrivée à '+time(task.incoming_arrival.checkin_time)+'.':'Aucune prochaine arrivée enregistrée.';card.append(next);
        const note=document.createElement('p');note.className='task-note';note.textContent='Consignes : '+(task.cleaning_note||'Aucune consigne particulière.');card.append(note);
        const actions=document.createElement('div');actions.className='task-actions';
        if(task.done){const label=document.createElement('span');label.className='badge ok';label.textContent='Rotation clôturée';actions.append(label)}
        else if(!task.requested){const label=document.createElement('span');label.className='badge';label.textContent='Le propriétaire doit transmettre la demande';actions.append(label)}
        else if(!task.received){const button=document.createElement('button');button.className='primary';button.textContent='Confirmer la réception de la demande';button.addEventListener('click',()=>update(button,task.booking_id,'received'));actions.append(button)}
        else{const button=document.createElement('button');button.className='primary';button.textContent='Valider le ménage terminé';button.addEventListener('click',()=>update(button,task.booking_id,'complete'));actions.append(button)}
        card.append(actions);tasks.append(card);
      });
      $('plan-status').textContent='Planning actualisé.';
    }catch(error){$('plan-status').textContent=error.message;if(/refusée|requise/.test(error.message))logout()}
  }
  async function update(button,id,action){button.disabled=true;try{await request('/api/cleaning/tasks/'+id+'/'+action,{});await refresh()}catch(error){$('plan-status').textContent=error.message;button.disabled=false}}
  function logout(){if(!accessKey)fetch('/api/account/logout',{method:'POST'}).catch(()=>{});accessKey='';keyInput.value='';$('clean-pin').value='';planning.hidden=true;login.hidden=false;$('login-status').textContent='Vous êtes déconnecté.'}
  async function openPlanning(){login.hidden=true;planning.hidden=false;await refresh()}
  $('login-form').addEventListener('submit',async event=>{
    event.preventDefault();const status=$('login-status');
    const useKey=!$('key-field').hidden;
    try{
      if(useKey){accessKey=keyInput.value.trim();status.textContent='Vérification de la clé…';await request('/api/cleaning/workspace')}
      else{
        accessKey='';status.textContent='Connexion…';
        const response=await fetch('/api/account/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:$('clean-name').value,pin:$('clean-pin').value})});
        const data=await response.json();if(!response.ok)throw Error(data.error||'Connexion impossible.');
      }
      status.textContent='';await openPlanning();
    }catch(error){accessKey='';status.textContent=error.message}
  });
  $('use-key').addEventListener('click',()=>{const showKey=$('key-field').hidden;$('clean-name').required=!showKey;$('clean-pin').required=!showKey;keyInput.required=showKey;$('key-field').hidden=!showKey;$('pin-fields').hidden=showKey;$('use-key').textContent=showKey?'Utiliser mon prénom et mon code':'Utiliser la clé d’équipe';(showKey?keyInput:$('clean-name')).focus()});
  // Session permanente : on rouvre directement le planning si l'appareil est déjà connecté.
  fetch('/api/account/me').then(response=>response.ok?response.json():null).then(member=>{if(member){$('who').textContent=member.name;openPlanning()}}).catch(()=>{});
  $('refresh').addEventListener('click',refresh);$('task-filter').addEventListener('change',refresh);$('logout').addEventListener('click',logout);
})();
