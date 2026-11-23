/*
 * Navigators ESV audio embed.
 * Uses the public Crossway ESV audio player, not an ESV download or API key.
 * WEB remains the on-page Scripture translation; audio is clearly labeled ESV.
 * Crossway owns playback inside its iframe. Avoid pretending we can pause,
 * seek, control speed, or detect the end of playback from this origin.
 * See https://www.esv.org/resources/audio-player/
 */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const passages=$('passages'),all=$('audio-all'),panel=$('esv-player');
  const iframe=$('esv-audio-frame'),title=$('esv-player-title');
  const close=$('audio-close'),status=$('audio-status');
  if(!passages||!all||!panel||!iframe||!close||!status)return;

  let activeKey='';
  function normalize(reference){
    // ESV uses Psalm (singular) and Song of Solomon as the book titles.
    return reference.trim()
      .replace(/^Psalms(?=\s+\d)/i,'Psalm')
      .replace(/^Song of Songs(?=\s+\d)/i,'Song of Solomon')
      .replace(/\s+/g,' ');
  }
  function refs(){
    return [...passages.querySelectorAll('.passage-group .passage-heading h3')]
      .map(el=>el.textContent.trim()).filter(Boolean).slice(0,4);
  }
  function audioURL(references){
    const passage=references.map(normalize).join('; ');
    // Encoding the whole passage mirrors Crossway's official iframe examples,
    // e.g. /audio-player/John%2B3%3A16/.
    return 'https://www.esv.org/audio-player/'+encodeURIComponent(passage.replace(/ /g,'+'))+'/';
  }
  function buttons(){
    all.setAttribute('aria-pressed',String(activeKey==='all'));
    for(const button of passages.querySelectorAll('[data-audio-index]')){
      const index=Number(button.dataset.audioIndex);
      const selected=activeKey==='single-'+index;
      button.setAttribute('aria-pressed',String(selected));
      button.textContent=selected?'ESV audio open':'Listen (ESV)';
    }
  }
  function clearAudio(message){
    // Removing src stops any audio currently playing inside the embedded frame.
    iframe.removeAttribute('src');
    panel.hidden=true;
    activeKey='';
    buttons();
    if(message)status.textContent=message;
  }
  function showAudio(references,key,label){
    if(!references.length){
      clearAudio('Could not find the Scripture references for this day.');
      return;
    }
    const url=audioURL(references);
    if(!/^https:\/\/www\.esv\.org\/audio-player\//.test(url))return;
    if(activeKey===key&&!panel.hidden){
      clearAudio('Audio closed. Tap Listen to open the ESV player again.');
      return;
    }
    activeKey=key;
    // Replacing src unloads any prior selection instead of overlapping audio.
    iframe.src=url;
    panel.hidden=false;
    title.textContent=label+' · ESV audio';
    status.textContent='ESV audio (Crossway) · WEB text below. Tap play inside the embedded player.';
    buttons();
    panel.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  all.addEventListener('click',()=>{
    const references=refs();
    showAudio(references,'all','All four readings');
  });
  passages.addEventListener('click',event=>{
    const button=event.target.closest('button[data-audio-index]');
    if(!button)return;
    const index=Number(button.dataset.audioIndex);
    const reference=refs()[index];
    if(!reference)return;
    showAudio([reference],'single-'+index,reference);
  });
  close.addEventListener('click',()=>clearAudio('ESV audio closed.'));
  window.addEventListener('navigators:day-changed',()=>clearAudio('Ready to listen to today’s ESV readings.'));
  window.addEventListener('navigators:rendered',()=>clearAudio('Choose a reading to listen to ESV narration.'));
  window.addEventListener('pagehide',()=>clearAudio());
  buttons();
})();
