/* SOD Pitch — shared deck engine (A & B versions identical) */
(function () {
  'use strict';
  var deck = document.getElementById('deck');
  if (!deck) return;
  var slides = Array.prototype.slice.call(deck.querySelectorAll('.slide'));
  var total = slides.length;
  var prevBtn = document.querySelector('.nav-prev');
  var nextBtn = document.querySelector('.nav-next');
  var progress = document.querySelector('.progress-bar');
  var chapterNav = document.getElementById('chapterNav');
  var menuBtn = document.querySelector('.menu-toggle');
  var current = 0;

  var chapters = [];
  slides.forEach(function (s, i) {
    var ch = s.getAttribute('data-chapter');
    if (ch) chapters.push({ idx: i, label: ch });
  });

  function activeChapterIndex() {
    var a = 0;
    chapters.forEach(function (c, ci) { if (c.idx <= current) a = ci; });
    return a;
  }

  function renderChapters() {
    if (!chapterNav) return;
    chapterNav.innerHTML = chapters.map(function (c, i) {
      return '<li><button class="chap" data-i="' + c.idx + '">' +
        '<span class="num">' + (i + 1) + '</span><span class="lbl">' + c.label + '</span></button></li>';
    }).join('');
    Array.prototype.forEach.call(chapterNav.querySelectorAll('.chap'), function (b) {
      b.addEventListener('click', function () { go(parseInt(b.dataset.i, 10)); });
    });
  }

  function go(i) {
    current = Math.max(0, Math.min(total - 1, i));
    slides.forEach(function (s, idx) { s.classList.toggle('is-active', idx === current); });
    deck.setAttribute('data-current', current);
    if (progress) progress.style.width = (current / (total - 1) * 100) + '%';
    if (chapterNav) {
      var ai = activeChapterIndex();
      Array.prototype.forEach.call(chapterNav.querySelectorAll('.chap'), function (b, bi) {
        b.classList.toggle('is-current', bi === ai);
      });
    }
    history.replaceState(null, '', '#s' + current);
  }

  function next() { go(current + 1); }
  function prev() { go(current - 1); }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); prev(); }
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(total - 1);
  });

  if (nextBtn) nextBtn.addEventListener('click', next);
  if (prevBtn) prevBtn.addEventListener('click', prev);
  if (menuBtn) menuBtn.addEventListener('click', function () {
    document.body.classList.toggle('menu-open');
  });

  var sx = 0, sy = 0;
  deck.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  deck.addEventListener('touchend', function (e) {
    var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 45) { dy < 0 ? next() : prev(); }
    else if (Math.abs(dx) > 70) { dx < 0 ? next() : prev(); }
  });

  var h = location.hash.match(/s(\d+)/);
  renderChapters();
  go(h ? parseInt(h[1], 10) : 0);
})();
