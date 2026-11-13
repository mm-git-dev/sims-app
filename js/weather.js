/* SIMS - Stage 7 (optional): one line with today's weather for the office city on Home, for people who are not the admin.
   Free Open-Meteo service, no account. Only the city's coordinates are sent. Saved on the device for an hour. */
(function () {
  'use strict';
  var App = window.App, $ = App.$, esc = App.esc;
  var URL = 'https://api.open-meteo.com/v1/forecast?latitude=28.46&longitude=77.03&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=Asia%2FKolkata&forecast_days=1';
  var WORDS = { 0: 'Clear sky', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Cloudy', 45: 'Fog', 48: 'Fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail' };
  function text(d) {
    var x = d && d.daily; if (!x || !x.temperature_2m_max) return '';
    var rain = x.precipitation_probability_max && x.precipitation_probability_max[0] !== null ? ' · rain chance ' + Math.round(x.precipitation_probability_max[0]) + '%' : '';
    return 'Gurugram today: ' + (WORDS[x.weather_code[0]] || 'Weather') + ', ' + Math.round(x.temperature_2m_min[0]) + '–' + Math.round(x.temperature_2m_max[0]) + '°C' + rain;
  }
  function stored() { try { var c = JSON.parse(localStorage.getItem('sims.wx') || 'null'); return c && Date.now() - c.t < 3600000 ? c.d : null; } catch (e) { return null; } }
  function fetchWx() {
    return fetch(URL).then(function (r) { return r.json(); }).then(function (d) { try { localStorage.setItem('sims.wx', JSON.stringify({ t: Date.now(), d: d })); } catch (e) { } return d; });
  }
  var render = App.pages.home.render;
  App.pages.home.render = function (view) {
    var out = render.apply(this, arguments);
    if (App.me && !App.me.user.admin) {
      var el = document.createElement('div'); el.id = 'hWx'; el.className = 'small muted'; el.style.margin = '4px 0 12px';
      var h2 = view.querySelector('h2'); if (h2) h2.parentNode.insertBefore(el, h2.nextSibling);
      var c = stored(); if (c) el.textContent = text(c);
      else fetchWx().then(function (d) { var e2 = $('#hWx'); if (e2) e2.textContent = text(d); }).catch(function () { /* no weather line if the service is unreachable */ });
    }
    return out;
  };
})();
