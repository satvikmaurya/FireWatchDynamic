// Runs on the connected phone via PebbleKit JS
// Fetches weather from Open-Meteo (free, no API key needed)
var Clay = require('@rebble/clay');
var clayConfig = require('./config');
var clay = new Clay(clayConfig, null, { autoHandleEvents: false });
var messageKeys = require('message_keys');

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function(e) {
  if (!e || !e.response || e.response === 'CANCELLED') return;
  clay.getSettings(e.response);
  var settings = JSON.parse(localStorage.getItem('clay-settings') || '{}');
  var msg = {};
  msg[5] = !!settings.TEMP_UNIT ? 1 : 0;
  msg[6] = !!settings.TIME_FORMAT ? 1 : 0;
  Pebble.sendAppMessage(msg,
    function() { console.log('Settings sent: ' + JSON.stringify(msg)); },
    function(err) { console.log('Send error: ' + JSON.stringify(err)); }
  );
  fetchWeather();
});

// Pebble.addEventListener('ready', function() {
//   fetchWeather();
// });

var s_weatherInterval = null;

Pebble.addEventListener('ready', function () {
  fetchWeather();
  if (s_weatherInterval) clearInterval(s_weatherInterval);
  s_weatherInterval = setInterval(fetchWeather, 20 * 60 * 1000);
});

Pebble.addEventListener('appmessage', function(e) {
  // messageKeys.REQUEST_WEATHER = 0 when module works
  // "0" is the guaranteed string integer fallback per Pebble docs
  var reqKey = messageKeys.REQUEST_WEATHER;
  if (e.payload[reqKey] !== undefined || e.payload['0'] !== undefined) {
    console.log('Watch requested weather update');
    fetchWeather();
  }
});

function getTempUnit() {
  return 'fahrenheit';
}

// function fetchWeather() {
//   var rawSettings = localStorage.getItem('clay-settings');
//   var settings    = rawSettings ? JSON.parse(rawSettings) : {};
//   var provider    = settings.WEATHER_PROVIDER || '0';

//   navigator.geolocation.getCurrentPosition(
//     function (pos) {
//       var lat = pos.coords.latitude.toFixed(4);
//       var lon = pos.coords.longitude.toFixed(4);
//       if      (provider === '1') fetchOpenWeatherMap(lat, lon, settings.OWM_API_KEY  || '');
//       else if (provider === '2') fetchWeatherAPI(lat, lon,     settings.WEATHERAPI_KEY || '');
//       else if (provider === '3') fetchNWS(lat, lon);
//       else                       fetchOpenMeteo(lat, lon);
//     },
//     function (err) { console.log('Geolocation error: ' + err.message); },
//     { timeout: 15000, maximumAge: 300000 }
//   );
// }

function fetchWeather() {
  var rawSettings  = localStorage.getItem('clay-settings');
  var settings     = rawSettings ? JSON.parse(rawSettings) : {};
  var customLoc    = (settings.CUSTOM_LOCATION || '').trim();

  if (customLoc) {
    resolveLocation(customLoc, function (lat, lon) {
      if (lat !== null) {
        dispatchFetch(lat, lon, settings);
      } else {
        console.log('Location not found, falling back to GPS');
        fetchWithGPS(settings);
      }
    });
  } else {
    fetchWithGPS(settings);
  }
}

function fetchWithGPS(settings) {
  navigator.geolocation.getCurrentPosition(
    function (pos) {
      dispatchFetch(
        pos.coords.latitude.toFixed(4),
        pos.coords.longitude.toFixed(4),
        settings
      );
    },
    function (err) { console.log('Geolocation error: ' + err.message); },
    { timeout: 15000, maximumAge: 300000 }
  );
}

// Accepts "lat,lon" coordinates or a city name.
// City names are geocoded via Open-Meteo's free geocoding API (no key needed).
function resolveLocation(str, callback) {
  var coords = str.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (coords) {
    callback(parseFloat(coords[1]).toFixed(4), parseFloat(coords[2]).toFixed(4));
    return;
  }
  var url = 'https://geocoding-api.open-meteo.com/v1/search?name=' +
    encodeURIComponent(str) + '&count=1&language=en&format=json';
  httpGet(url, null, function (d) {
    if (d.results && d.results.length > 0) {
      callback(d.results[0].latitude.toFixed(4), d.results[0].longitude.toFixed(4));
    } else {
      callback(null, null);
    }
  });
}

function dispatchFetch(lat, lon, settings) {
  var provider = settings.WEATHER_PROVIDER || '0';
  if      (provider === '1') fetchOpenWeatherMap(lat, lon, settings.OWM_API_KEY   || '');
  else if (provider === '2') fetchWeatherAPI(lat, lon,     settings.WEATHERAPI_KEY || '');
  else if (provider === '3') fetchNWS(lat, lon);
  else                       fetchOpenMeteo(lat, lon);
}

// ── Open-Meteo ────────────────────────────────────────────────────────────────
function fetchOpenMeteo(lat, lon) {
  var url = 'https://api.open-meteo.com/v1/forecast' +
    '?latitude=' + lat + '&longitude=' + lon +
    '&current=temperature_2m,weather_code' + '&temperature_unit=fahrenheit' +
    '&daily=sunrise,sunset&timezone=auto&timeformat=unixtime';
  console.log('Watch requested weather update (openMeteo)');
  httpGet(url, null, function (d) {
    sendWeather(
      Math.round(d.current.temperature_2m),
      d.current.weather_code || d.current.weathercode,
      d.daily.sunrise[0],
      d.daily.sunset[0]
    );
  });
}

// ── OpenWeatherMap ────────────────────────────────────────────────────────────
function fetchOpenWeatherMap(lat, lon, apiKey) {
  apiKey = (apiKey || '').trim();

  if (!apiKey) {
    console.log('OWM: no API key set, falling back to Open-Meteo');
    fetchOpenMeteo(lat, lon);
    return;
  }

  console.log('Watch requested weather update (OpenWeatherMap)');
  console.log('OWM API key length: ' + apiKey.length);

  var url = 'https://api.openweathermap.org/data/2.5/weather' +
    '?lat=' + encodeURIComponent(lat) +
    '&lon=' + encodeURIComponent(lon) +
    '&appid=' + encodeURIComponent(apiKey) +
    '&units=imperial';

  httpGet(url, null, function (d) {
    console.log('OWM status: ' + d.cod);
    console.log('OWM response: ' + JSON.stringify(d));

    if (Number(d.cod) !== 200) {
      console.log('OWM error: ' + d.message);
      fetchOpenMeteo(lat, lon); // optional fallback
      return;
    }

    sendWeather(
      Math.round(d.main.temp),
      owmToWmo(d.weather[0].id),
      d.sys.sunrise,
      d.sys.sunset
    );
  });
}


function owmToWmo(id) {
  if (id === 800)             return 0;   // clear
  if (id === 801)             return 1;   // few clouds
  if (id === 802)             return 2;   // scattered clouds
  if (id >= 803)              return 3;   // broken/overcast
  if (id >= 200 && id < 300) return 95;  // thunderstorm
  if (id >= 300 && id < 400) return 53;  // drizzle
  if (id >= 500 && id < 600) return 63;  // rain
  if (id >= 600 && id < 700) return 73;  // snow
  if (id >= 700 && id < 800) return 45;  // fog/mist/haze
  return 0;
}

// ── WeatherAPI.com ────────────────────────────────────────────────────────────
function fetchWeatherAPI(lat, lon, apiKey) {
  if (!apiKey) {
    console.log('WeatherAPI: no API key set, falling back to Open-Meteo');
    fetchOpenMeteo(lat, lon);
    return;
  }
  console.log('Watch requested weather update (WeatherAPI)');
  var url = 'https://api.weatherapi.com/v1/forecast.json' +
    '?key=' + apiKey + '&q=' + lat + ',' + lon + '&days=1&aqi=no';
  httpGet(url, null, function (d) {
    if (d.error) { console.log('WeatherAPI error: ' + d.error.message); return; }
    var times = weatherApiSunTimes(d);
    sendWeather(
      Math.round(d.current.temp_f),
      weatherApiToWmo(d.current.condition.code),
      times.sunrise,
      times.sunset
    );
  });
}

function weatherApiToWmo(code) {
  if (code === 1000) return 0;                          // sunny/clear
  if (code === 1003) return 1;                          // partly cloudy
  if (code === 1006 || code === 1009) return 3;         // cloudy/overcast
  if (code === 1030 || code === 1135 || code === 1147) return 45; // mist/fog
  if (code >= 1150 && code <= 1153) return 51;          // light drizzle
  if (code === 1168 || code === 1171 || code === 1072) return 56; // freezing drizzle
  if (code === 1063 || (code >= 1180 && code <= 1201)) return 63; // rain
  if (code >= 1240 && code <= 1246) return 80;          // rain showers
  if (code === 1066 || (code >= 1210 && code <= 1225)) return 73; // snow
  if (code === 1114 || code === 1117) return 75;        // blizzard
  if (code >= 1255 && code <= 1258) return 85;          // snow showers
  if (code === 1069 || code === 1204 || code === 1207 ||
      code === 1237 || (code >= 1249 && code <= 1264)) return 77; // sleet/ice
  if (code === 1087 || (code >= 1273 && code <= 1282)) return 95; // thunder
  return 0;
}

// WeatherAPI gives sunrise/sunset as "06:45 AM" local strings.
// Derive UTC offset from localtime_epoch vs localtime string, then convert.
function weatherApiSunTimes(d) {
  try {
    var ltEpoch = d.location.localtime_epoch;
    var ltStr   = d.location.localtime; // "2024-01-15 14:30"
    var lp = ltStr.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
    if (!lp) return { sunrise: 0, sunset: 0 };
    var ltAsUtc   = Date.UTC(+lp[1], lp[2]-1, +lp[3], +lp[4], +lp[5]) / 1000;
    var utcOffset = ltEpoch - ltAsUtc;

    var dateStr = d.forecast.forecastday[0].date;
    var astro   = d.forecast.forecastday[0].astro;

    function toEpoch(timeStr) {
      var m = timeStr.match(/(\d+):(\d+) (AM|PM)/i);
      if (!m) return 0;
      var h = +m[1], min = +m[2], ampm = m[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h  =  0;
      var dp = dateStr.split('-');
      return Date.UTC(+dp[0], dp[1]-1, +dp[2], h, min) / 1000 + utcOffset;
    }

    return { sunrise: toEpoch(astro.sunrise), sunset: toEpoch(astro.sunset) };
  } catch (e) {
    return { sunrise: 0, sunset: 0 };
  }
}

// ── Weather.gov (US only) ─────────────────────────────────────────────────────
function fetchNWS(lat, lon) {
  var pointsUrl = 'https://api.weather.gov/points/' + lat + ',' + lon;
  // NWS requires a User-Agent identifying your app
  httpGet(pointsUrl, { 'User-Agent': 'MountainLakeWatchface/1.0' }, function (d) {
    if (!d.properties || !d.properties.forecastHourly) {
      console.log('NWS: no forecast URL — location may be outside the US');
      return;
    }
    console.log('Watch requested weather update (NWS)');
    httpGet(d.properties.forecastHourly,
            { 'User-Agent': 'MountainLakeWatchface/1.0' },
            function (f) {
      var period = f.properties.periods[0];
      // NWS always returns Fahrenheit; convert to Celsius for C code
      var tempC  = Math.round((period.temperature - 32) * 5 / 9);
      // NWS has no sunrise/sunset — C falls back to hour-based TOD
      sendWeather(period.temperature, nwsIconToWmo(period.icon), 0, 0);
    });
  });
}

function nwsIconToWmo(iconUrl) {
  var m = iconUrl.match(/\/icons\/land\/(?:day|night)\/([a-z_]+)/);
  if (!m) return 0;
  switch (m[1].split(',')[0]) {
    case 'skc': case 'hot': case 'cold':          return 0;   // clear
    case 'few': case 'wind_few':                  return 1;   // few clouds
    case 'sct': case 'wind_sct':                  return 2;   // scattered
    case 'bkn': case 'ovc':
    case 'wind_bkn': case 'wind_ovc':             return 3;   // cloudy
    case 'fg': case 'smoke': case 'haze':
    case 'dust': case 'sand':                     return 45;  // fog
    case 'drizzle':                               return 53;  // drizzle
    case 'rain': case 'rain_showers':
    case 'rain_showers_hi':                       return 63;  // rain
    case 'fzra': case 'rain_fzra':                return 66;  // freezing rain
    case 'snow': case 'blizzard':                 return 73;  // snow
    case 'sleet':                                 return 77;  // sleet
    case 'tsra': case 'tsra_sct': case 'tsra_hi': return 95; // thunderstorm
    case 'tornado':                               return 99;  // extreme
    default:                                      return 0;
  }
}

// ── Shared helpers ────────────────────────────────────────────────────────────
function httpGet(url, headers, onSuccess) {
  var xhr = new XMLHttpRequest();
  xhr.onload = function () {
    try {
      var d = JSON.parse(this.responseText);
      onSuccess(d);
    } catch (e) { console.log('Parse error: ' + e); }
  };
  xhr.onerror = function () { console.log('Network error: ' + url); };
  xhr.open('GET', url);
  if (headers) {
    Object.keys(headers).forEach(function (k) {
      xhr.setRequestHeader(k, headers[k]);
    });
  }
  xhr.send();
}

function sendWeather(temp, code, sunrise, sunset) {
  var rawSettings = localStorage.getItem('clay-settings');
  var hasSettings = rawSettings !== null;
  var settings    = hasSettings ? JSON.parse(rawSettings) : {};
  var msg = {};
  msg[1] = temp;
  msg[2] = code;
  msg[3] = sunrise;
  msg[4] = sunset;
  msg[5] = (hasSettings ? !!settings.TEMP_UNIT  : true)  ? 1 : 0;
  msg[6] = (hasSettings ? !!settings.TIME_FORMAT : false) ? 1 : 0;
  Pebble.sendAppMessage(msg,
    function ()  { console.log('Weather sent: ' + JSON.stringify(msg)); },
    function (e) { console.log('Send error: '   + JSON.stringify(e)); }
  );
}

// function fetchWeather() {
//   navigator.geolocation.getCurrentPosition(
//     function (pos) {
//       var lat = pos.coords.latitude.toFixed(4);
//       var lon = pos.coords.longitude.toFixed(4);

//       // Open-Meteo: completely free, no sign-up, no key
//       var unit = getTempUnit();

//       var url = 'https://api.open-meteo.com/v1/forecast' +
//         '?latitude='  + lat +
//         '&longitude=' + lon +
//         '&current=temperature_2m,weather_code' +
//         '&daily=sunrise,sunset' +
//         '&temperature_unit=' + unit +
//         '&timezone=auto' +
//         '&timeformat=unixtime';

//       var xhr = new XMLHttpRequest();
//       xhr.onload = function () {
//         try {
//           var d    = JSON.parse(this.responseText);
//           var temp = Math.round(d.current.temperature_2m);
//           var code = d.current.weather_code;
//           if (code === undefined) code = d.current.weathercode;
//           console.log('Weather: ' + temp + 'F, WMO code ' + code);
//           var sunrise = d.daily.sunrise[0];
//           var sunset  = d.daily.sunset[0];
// //           var msg = {};
// //           Pebble.sendAppMessage({
// //               TEMPERATURE: temp,
// //               CONDITIONS: code,
// //               SUNRISE: sunrise,
// //               SUNSET: sunset,
// //               TEMP_UNIT: unit === 'fahrenheit' ? 1 : 0
// //             },
// //             function ()  { console.log('Sent OK'); },
// //             function (e) { console.log('Send error: ' + JSON.stringify(e)); }
// //           );
//           var msg = {};
//           msg[1] = temp;
//           msg[2] = code;
//           msg[3] = sunrise;
//           msg[4] = sunset;
//           var rawSettings = localStorage.getItem('clay-settings');
//           var hasSettings = rawSettings !== null;
//           var settings = hasSettings ? JSON.parse(rawSettings) : {};
//           msg[5] = (hasSettings ? !!settings.TEMP_UNIT  : true) ? 1 : 0;
//           msg[6] = (hasSettings ? !!settings.TIME_FORMAT : false) ? 1 : 0;
// //           msg[5] = unit === 'fahrenheit' ? 1 : 0;
          
//           Pebble.sendAppMessage(
//             msg,
//             function ()  { console.log('Sent OK: ' + JSON.stringify(msg)); },
//             function (e) { console.log('Send error: ' + JSON.stringify(e)); }
//           );
//         } catch (err) {
//           console.log('Parse error: ' + err);
//         }
//       };
//       xhr.onerror = function () { console.log('Network error'); };
//       xhr.open('GET', url);
//       xhr.send();
//     },
//     function (err) {
//       console.log('Geolocation error: ' + err.message);
//     },
//     { timeout: 15000, maximumAge: 300000 }  // cache position for 5 min
//   );
// }