(() => {
  const form = document.getElementById('booking-form');
  if (!form) return;
  const arrival = form.elements.arrival;
  const departure = form.elements.departure;
  const guests = form.elements.guests;
  const status = document.getElementById('status');
  const submit = document.getElementById('submit');
  const panel = document.createElement('div');
  panel.className = 'availability';
  panel.innerHTML = '<h3>Vos dates, votre séjour</h3><p class="calendar-legend">Vert : disponible et tarifé · Gris : occupé · Pointillé : tarif à définir. Une demande reste soumise à confirmation.</p><div class="calendar-toolbar"><button type="button" id="previous-month" aria-label="Mois précédent">Précédent</button><span id="month-title" aria-live="polite"></span><button type="button" id="next-month" aria-label="Mois suivant">Suivant</button></div><div id="guest-calendar" class="calendar-grid"></div><p id="calendar-message" role="status"></p><button type="button" class="btn" id="calculate-quote">Vérifier les dates et le prix</button><div id="quote-result" class="quote-details" role="status" aria-live="polite"></div>';
  form.insertBefore(panel, form.firstChild);
  const result = document.getElementById('quote-result');
  const calendar = document.getElementById('guest-calendar');
  let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let quote = null;
  let revision = 0;
  let calendarRevision = 0;
  const money = cents => new Intl.NumberFormat('fr-BE', {style:'currency', currency:'EUR'}).format(cents / 100);
  const prettyDate = value => new Intl.DateTimeFormat('fr-BE', {dateStyle:'medium'}).format(new Date(value+'T12:00:00'));
  const payload = () => Object.fromEntries(new FormData(form));
  async function api(path, data) {
    const response = await fetch(path, data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {});
    const body = await response.json();
    if (!response.ok) throw Error(body.error || 'Réessayez dans un instant.');
    return body;
  }
  async function renderCalendar() {
    const current = ++calendarRevision;
    const year = month.getFullYear(), selectedMonth = month.getMonth();
    document.getElementById('month-title').textContent = new Intl.DateTimeFormat('fr-BE',{month:'long',year:'numeric'}).format(month);
    calendar.replaceChildren();
    document.getElementById('calendar-message').textContent = 'Chargement des disponibilités…';
    try {
      const data = await api('/api/availability?year='+year);
      if (current !== calendarRevision) return;
      ['L','M','M','J','V','S','D'].forEach(day => {const cell=document.createElement('span');cell.className='calendar-weekday';cell.textContent=day;calendar.append(cell)});
      const offset = (new Date(year, selectedMonth, 1).getDay()+6)%7;
      for (let count=0;count<offset;count++) calendar.append(document.createElement('span'));
      data.days.filter(day=>Number(day.date.slice(5,7))===selectedMonth+1).forEach(day=>{
        const cell=document.createElement('span');cell.className='calendar-day';cell.dataset.state=day.state;
        cell.textContent=Number(day.date.slice(8));
        const label={available:'disponible',occupied:'occupé',unpriced:'tarif à définir'}[day.state];
        cell.setAttribute('aria-label',prettyDate(day.date)+', '+label+(day.cents===null?'':', '+money(day.cents)));
        cell.title=cell.getAttribute('aria-label');
        cell.dataset.selected=String(Boolean(arrival.value && departure.value && day.date>=arrival.value && day.date<departure.value));calendar.append(cell);
      });
      document.getElementById('calendar-message').textContent='Choisissez votre arrivée et votre départ dans les champs ci-dessous.';
    } catch (error) {
      if (current===calendarRevision) document.getElementById('calendar-message').textContent='Calendrier indisponible : '+error.message;
    }
  }
  document.getElementById('previous-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()-1,1);renderCalendar()});
  document.getElementById('next-month').addEventListener('click',()=>{month=new Date(month.getFullYear(),month.getMonth()+1,1);renderCalendar()});
  [arrival,departure,guests].forEach(input=>input.addEventListener('input',()=>{quote=null;revision++;result.textContent='Dates ou groupe modifiés : recalculez votre prix.'}));
  departure.addEventListener('change',()=>{if(arrival.value){month=new Date(arrival.value+'T12:00:00');month.setDate(1)}renderCalendar()});
  async function calculate() {
    if (![arrival,departure,guests].every(input=>input.reportValidity())) return null;
    const current=++revision;
    quote=null;result.className='quote-details';result.textContent='Vérification du séjour…';
    try {
      const data=await api('/api/quote',payload());
      if(current!==revision)return null;
      quote=data;result.replaceChildren();
      const total=document.createElement('p');total.className='quote-total';total.textContent=money(data.total_cents)+' pour '+data.nights.length+' nuits';result.append(total);
      const cleaning=document.createElement('p');cleaning.textContent='Dont ménage : '+money(data.cleaning_cents)+'. Prix du logement entier pour votre groupe.';result.append(cleaning);
      const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Voir le détail des nuits';details.append(summary);
      data.nights.forEach(night=>{const line=document.createElement('p');line.className='quote-night';const label=document.createElement('span'),amount=document.createElement('span');label.textContent=prettyDate(night.date);amount.textContent=money(night.cents);line.append(label,amount);details.append(line)});result.append(details);
      return data;
    } catch(error) {if(current===revision){result.className='quote-details quote-error';result.textContent=error.message}return null}
  }
  document.getElementById('calculate-quote').addEventListener('click',calculate);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    if(!quote){await calculate();status.textContent='Vérifiez le prix affiché puis cliquez à nouveau sur « Demander ce séjour ».';return}
    const data=payload();data.quote_token=quote.token;
    submit.disabled=true;submit.textContent='Enregistrement…';
    try {
      const response=await api('/api/requests',data);
      status.className='';status.textContent='Demande n° '+response.id+' enregistrée pour '+money(response.total_cents)+'. En attente de confirmation du propriétaire. Aucun paiement effectué et aucun e-mail envoyé.';
      quote=null;revision++;form.reset();departure.min=arrival.min;result.replaceChildren();renderCalendar();
    } catch(error) {quote=null;status.className='error';status.textContent=error.message}
    finally {submit.disabled=false;submit.textContent='Demander ce séjour'}
  });
  renderCalendar();
})();
