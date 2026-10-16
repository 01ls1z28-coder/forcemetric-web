(function(){"use strict";
var tabs=[].slice.call(document.querySelectorAll(".tab")),q=document.getElementById("q"),
secs=[].slice.call(document.querySelectorAll(".cat")),empty=document.querySelector(".empty"),f="all";
function run(){var s=(q.value||"").trim().toLowerCase(),any=0;
secs.forEach(function(sec){var n=0;sec.querySelectorAll(".card").forEach(function(c){
var ok=(f==="all"||c.dataset.cat===f)&&(!s||c.dataset.search.indexOf(s)>-1);c.hidden=!ok;if(ok)n++;});
sec.hidden=!n;any+=n;});empty.hidden=!!any;var m=document.getElementById("cats");m.classList.remove("anim");void m.offsetWidth;m.classList.add("anim");}
tabs.forEach(function(t){t.addEventListener("click",function(){f=t.dataset.filter;
tabs.forEach(function(x){var on=x===t;x.classList.toggle("is-on",on);x.setAttribute("aria-pressed",on);});run();});});
q.addEventListener("input",run);
document.addEventListener("keydown",function(e){if(e.key==="/"&&document.activeElement!==q){e.preventDefault();q.focus();}});
})();
