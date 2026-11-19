function bookingDateAfter(value, count) {
  const current = new Date(value+'T12:00:00');
  current.setDate(current.getDate()+count);
  return current.getFullYear()+'-'+String(current.getMonth()+1).padStart(2,'0')+'-'+String(current.getDate()).padStart(2,'0');
}

function bookingSlot(day, packageName, calendarDays, today) {
  const weekday = packageName==='midweek'?1:5;
  if (new Date(day.date+'T12:00:00').getDay()!==weekday) return {selectable:false,reason:'other'};
  if (day.date<today) return {selectable:false,reason:'past'};
  const duration = packageName==='midweek'?4:3;
  const departure = bookingDateAfter(day.date,duration);
  for (let offset=0;offset<duration;offset++) {
    const night=calendarDays.get(bookingDateAfter(day.date,offset));
    if (!night) return {selectable:false,reason:'unknown'};
    if (night.state==='occupied') return {selectable:false,reason:'occupied'};
  }
  if (day.cents===null || day.price_basis!=='package') return {selectable:false,reason:'unpriced'};
  return {selectable:true,reason:'available',departure};
}

function bookingDateChoice(selection, value, packageName, calendarDays, today) {
  const start=calendarDays.get(selection.arrival);
  if(selection.arrival&&!selection.departure&&start) {
    const slot=bookingSlot(start,packageName,calendarDays,today);
    if(slot.selectable&&value===slot.departure)return {arrival:selection.arrival,departure:value};
  }
  const day=calendarDays.get(value);
  if(day&&bookingSlot(day,packageName,calendarDays,today).selectable)return {arrival:value,departure:''};
  return {arrival:selection.arrival,departure:selection.departure};
}

(() => {
  const form=document.getElementById('booking-form');
  if (!form) return;
  const arrival=form.elements.arrival,departure=form.elements.departure,guests=form.elements.guests;
  const packageField=form.elements.package;
  const packageInputs=Array.from(form.querySelectorAll('input[name="package"]'));
  const calendar=document.getElementById('guest-calendar');
  const calendarMessage=document.getElementById('calendar-message');
  const result=document.getElementById('quote-result');
  const status=document.getElementById('status');
  const submit=document.getElementById('submit');
  const calculateButton=document.getElementById('calculate-quote');
  const now=new Date();
  const today=bookingDateAfter(now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0'),0);
  let month=new Date(now.getFullYear(),now.getMonth(),1);
  let quote=null,revision=0,calendarRevision=0;
  const money=value=>new Intl.NumberFormat('fr-BE',{style:'currency',currency:'EUR'}).format(value/100);
  const prettyDate=value=>new Intl.DateTimeFormat('fr-BE',{day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00'));
  const packageLabel=()=>packageField.value==='midweek'?'Mid-week':'Week-end';
  const payload=()=>Object.fromEntries(new FormData(form));
  function invalidate() {quote=null;revision++;result.replaceChildren();status.textContent='';status.className=''}
  function updatePackage() {
    const weekday=packageField.value==='midweek'?1:5;
    const first=new Date(today+'T12:00:00');
    const minimum=bookingDateAfter(today,(weekday-first.getDay()+7)%7);
    arrival.min=minimum;arrival.step='7';arrival.setCustomValidity('');
    if(arrival.value) {
      const start=new Date(arrival.value+'T12:00:00');
      if(start.getDay()!==weekday)arrival.setCustomValidity(packageField.value==='midweek'?'Choisissez un lundi pour le mid-week.':'Choisissez un vendredi pour le week-end.');
      else if(arrival.value<today)arrival.setCustomValidity('Choisissez une date d’arrivée à venir.');
      else departure.min=bookingDateAfter(arrival.value,packageField.value==='midweek'?4:3);
    }
    document.getElementById('package-schedule').textContent=packageField.value==='midweek'?'Arrivée le lundi à 17 h, départ le vendredi à 9 h.':'Arrivée le vendredi à 17 h, départ le lundi à 9 h.';
    document.getElementById('selected-stay').textContent=departure.value
      ?packageLabel()+' du '+prettyDate(arrival.value)+' à 17 h au '+prettyDate(departure.value)+' à 9 h.'
      :arrival.value
        ?'Arrivée le '+prettyDate(arrival.value)+' à 17 h. Cliquez maintenant sur '+(packageField.value==='midweek'?'le vendredi':'le lundi')+' de départ dans le calendrier.'
        :'Cliquez sur votre arrivée, puis sur votre départ dans le calendrier.';
  }
  async function api(path,data) {
    const response=await fetch(path,data?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{});
    const body=await response.json();
    if(!response.ok)throw Error(body.error||'Réessayez dans un instant.');
    return body;
  }
  async function renderCalendar(focusDate) {
    const current=++calendarRevision;
    const year=month.getFullYear(),selectedMonth=month.getMonth();
    document.getElementById('month-title').textContent=new Intl.DateTimeFormat('fr-BE',{month:'long',year:'numeric'}).format(month);
    calendar.setAttribute('aria-busy','true');calendar.replaceChildren();
    calendarMessage.textContent='Chargement des disponibilités…';
    document.getElementById('previous-month').disabled=year===now.getFullYear()&&selectedMonth===now.getMonth();
    document.getElementById('next-month').disabled=year===2100&&selectedMonth===11;
    try {
      const years=new Set([year]);
      if(selectedMonth===11&&year<2100)years.add(year+1);
      if(arrival.value)years.add(Number(arrival.value.slice(0,4)));
      const calendars=await Promise.all([...years].map(value=>api('/api/availability?year='+value)));
      if(current!==calendarRevision)return;
      const days=new Map(calendars.flatMap(data=>data.days).map(day=>[day.date,day]));
      const selection={arrival:arrival.value,departure:departure.value};
      const selectedStart=days.get(selection.arrival);
      const pendingSlot=selection.arrival&&!selection.departure&&selectedStart?bookingSlot(selectedStart,packageField.value,days,today):null;
      ['Lun.','Mar.','Mer.','Jeu.','Ven.','Sam.','Dim.'].forEach(label=>{const cell=document.createElement('span');cell.className='calendar-weekday';cell.textContent=label;calendar.append(cell)});
      const offset=(new Date(year,selectedMonth,1).getDay()+6)%7;
      for(let count=0;count<offset;count++){const blank=document.createElement('span');blank.setAttribute('aria-hidden','true');calendar.append(blank)}
      let available=0;
      calendars.find(data=>data.year===year).days.filter(day=>Number(day.date.slice(5,7))===selectedMonth+1).forEach(day=>{
        const slot=bookingSlot(day,packageField.value,days,today);
        const endChoice=Boolean(pendingSlot?.selectable&&day.date===pendingSlot.departure);
        const candidate=slot.reason!=='other'||endChoice;
        const cell=document.createElement(candidate?'button':'span');
        cell.className='calendar-day';
        cell.dataset.state=day.state;
        cell.dataset.date=day.date;
        cell.dataset.arrival=String(candidate);
        cell.dataset.selected=String(Boolean(day.date===arrival.value||arrival.value&&departure.value&&day.date>=arrival.value&&day.date<=departure.value));
        cell.dataset.endChoice=String(endChoice);
        cell.dataset.checkout=String(day.date===departure.value);
        const number=document.createElement('span');number.className='day-number';number.textContent=Number(day.date.slice(8));cell.append(number);
        if(candidate) {
          cell.type='button';cell.disabled=!slot.selectable&&!endChoice;
          cell.setAttribute('aria-pressed',String(day.date===arrival.value||day.date===departure.value));
          const label=document.createElement('small');
          label.textContent=endChoice?'Départ':day.date===arrival.value?'Arrivée':{available:'Arrivée',occupied:'Complet',unpriced:'À définir',past:'Passé',unknown:'À vérifier'}[slot.reason];cell.append(label);
          if(slot.selectable)available++;
          cell.setAttribute('aria-label',endChoice
            ?'Choisir le départ le '+prettyDate(day.date)+' à 9 h et valider les dates de votre '+packageLabel()+'.'
            :slot.selectable
            ?'Choisir l’arrivée le '+prettyDate(day.date)+' à 17 h. '+packageLabel()+' jusqu’au '+prettyDate(slot.departure)+' à 9 h. Forfait logement '+money(day.cents)+', ménage en supplément.'
            :prettyDate(day.date)+' : '+label.textContent);
          cell.addEventListener('click',()=>{
            invalidate();
            const next=bookingDateChoice({arrival:arrival.value,departure:departure.value},day.date,packageField.value,days,today);
            arrival.value=next.arrival;departure.value=next.departure;updatePackage();
            const focus=next.departure||bookingDateAfter(next.arrival,packageField.value==='midweek'?4:3);
            if(!next.departure){month=new Date(focus+'T12:00:00');month.setDate(1)}
            renderCalendar(focus);
          });
        } else {
          cell.setAttribute('aria-label',prettyDate(day.date)+(day.date===departure.value?' : départ à 9 h':''));
          if(day.date===departure.value){cell.tabIndex=-1;const label=document.createElement('small');label.textContent='Départ';cell.append(label)}
        }
        cell.title=cell.getAttribute('aria-label');
        calendar.append(cell);
      });
      calendarMessage.textContent=selection.arrival&&!selection.departure
        ?pendingSlot?.selectable
          ?'Arrivée choisie. Cliquez sur le '+prettyDate(pendingSlot.departure)+' marqué « Départ » pour valider votre séjour.'
          :'Cette arrivée n’est plus disponible. Choisissez une nouvelle arrivée ou effacez les dates.'
        :selection.departure
          ?'Vos deux dates sont choisies. Elles sont affichées dans le récapitulatif du séjour.'
          :available
            ?'Premier clic : choisissez '+(packageField.value==='midweek'?'un lundi':'un vendredi')+' d’arrivée. Second clic : validez le départ proposé.'
            :'Aucune arrivée disponible et tarifée ce mois-ci. Essayez le mois suivant ou l’autre forfait.';
      if(focusDate)calendar.querySelector('[data-date="'+focusDate+'"]')?.focus({preventScroll:true});
    } catch(error) {
      if(current===calendarRevision)calendarMessage.textContent='Calendrier indisponible : '+error.message+'. Réessayez en changeant de mois.';
    } finally {if(current===calendarRevision)calendar.setAttribute('aria-busy','false')}
  }
  document.getElementById('previous-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);renderCalendar()});
  document.getElementById('next-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);renderCalendar()});
  function clearSelection() {invalidate();arrival.value='';departure.value='';updatePackage();renderCalendar()}
  packageInputs.forEach(input=>input.addEventListener('change',clearSelection));
  document.getElementById('clear-booking-dates').addEventListener('click',clearSelection);
  guests.addEventListener('input',invalidate);
  async function calculate() {
    if(!arrival.value||!departure.value){result.className='quote-details quote-error';result.textContent='Cliquez sur votre arrivée puis sur votre départ dans le grand calendrier.';return null}
    if(![arrival,departure,guests].every(input=>input.reportValidity()))return null;
    const current=++revision;quote=null;result.className='quote-details';result.textContent='Vérification du forfait…';calculateButton.disabled=true;
    try {
      const data=await api('/api/quote',payload());
      if(current!==revision)return null;
      quote=data;result.replaceChildren();
      const total=document.createElement('p');total.className='quote-total';total.textContent=money(data.total_cents)+' pour votre '+data.package_label.toLowerCase();result.append(total);
      const price=document.createElement('p');price.textContent='Logement entier : '+money(data.package_cents)+' + ménage : '+money(data.cleaning_cents)+'.';result.append(price);
      const schedule=document.createElement('p');schedule.textContent=prettyDate(data.arrival)+' à 17 h → '+prettyDate(data.departure)+' à 9 h.';result.append(schedule);
      return data;
    } catch(error){if(current===revision){result.className='quote-details quote-error';result.textContent=error.message}return null}
    finally {calculateButton.disabled=false}
  }
  calculateButton.addEventListener('click',calculate);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(!arrival.value||!departure.value){await calculate();return}
    if(!form.reportValidity())return;
    if(!quote){const data=await calculate();status.textContent=data?'Vérifiez le forfait affiché, puis cliquez à nouveau sur « Demander ce séjour ».':'Vérifiez les dates et le message indiqué avant de continuer.';return}
    const data=payload();data.quote_token=quote.token;submit.disabled=true;submit.textContent='Enregistrement…';
    try {
      const response=await api('/api/requests',data);
      status.className='';status.textContent='Demande n° '+response.id+' enregistrée pour '+money(response.total_cents)+'. En attente de confirmation du propriétaire. Aucun paiement effectué ni e-mail envoyé.';
      quote=null;revision++;form.reset();updatePackage();result.replaceChildren();renderCalendar();
    }catch(error){quote=null;status.className='error';status.textContent=error.message}
    finally{submit.disabled=false;submit.textContent='Demander ce séjour'}
  });
  updatePackage();renderCalendar();
})();
