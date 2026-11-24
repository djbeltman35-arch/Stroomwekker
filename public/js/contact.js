(function(){var s=document.getElementById('onderwerp'),m=document.getElementById('merkVeld'),t=document.getElementById('extraTip');
  var tips={'Hulp bij het koppelen van mijn slimme stekker':'Tip: zet in je bericht bij welke stap je vastloopt en wat er op je scherm staat.','Mijn apparaat gaat niet aan of uit':'Tip: open Stroomwekker en kijk bij "Wat staat er aan". Staat daar een melding? Neem die over in je bericht.','Ik krijg geen berichten':'Tip: op een iPhone werken berichten alleen als Stroomwekker op je beginscherm staat.','Mijn gegevens wissen of privacy':'Alles meteen wissen kan ook zelf, met de knop op de <a href="/privacy/">privacypagina</a>.'};
  s.addEventListener('change',function(){var v=s.value;m.hidden=!(v.indexOf('stekker')>-1||v.indexOf('aan of uit')>-1);t.hidden=!tips[v];t.innerHTML=tips[v]||'';});})();
(function(){var q=new URLSearchParams(location.search);if(!q.get('onderwerp'))return;var f=document.querySelector('.cform');if(!f)return;
  var s=f.querySelector('[name=onderwerp]'),m=f.querySelector('[name=merk]'),b=f.querySelector('[name=bericht]');
  [].forEach.call(s.options,function(o){if(o.text===q.get('onderwerp'))s.value=o.value||o.text;});s.dispatchEvent(new Event('change'));
  if(q.get('merk'))[].forEach.call(m.options,function(o){if(o.text===q.get('merk'))m.value=o.value||o.text;});
  if(q.get('bericht'))b.value=q.get('bericht');
  history.replaceState(null,'',location.pathname);var n=f.querySelector('[name=naam]');n&&n.focus({preventScroll:true});})();
