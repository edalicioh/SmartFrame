(function (app) {
  "use strict";
  var config,
    data = null;
  function condition(code) {
    if (code === 0) return "Céu limpo";
    if (code === 1) return "Predominantemente limpo";
    if (code === 2) return "Parcialmente nublado";
    if (code === 3) return "Nublado";
    if (code === 45 || code === 48) return "Neblina";
    if (code >= 51 && code <= 57) return "Garoa";
    if (code >= 61 && code <= 67) return "Chuva";
    if (code >= 71 && code <= 77) return "Neve";
    if (code >= 80 && code <= 82) return "Pancadas de chuva";
    if (code >= 85 && code <= 86) return "Pancadas de neve";
    if (code >= 95) return "Trovoadas";
    return "Condição indisponível";
  }
  function temperature(value) {
    return Math.round(value) + "°";
  }
  function render() {
    if (!config || !config.enabled) return;
    var status = document.getElementById("weather-status");
    document.getElementById("weather-city").textContent = config.city;
    document.getElementById("weather-condition").textContent = data
      ? condition(data.weatherCode)
      : "Aguardando atualização";
    document.getElementById("weather-temperature").textContent = data
      ? temperature(data.temperature)
      : "—";
    document.getElementById("weather-range").textContent = data
      ? "Máx. " + temperature(data.maximum) + "  ·  Mín. " + temperature(data.minimum)
      : "Dados indisponíveis";
    status.textContent = data
      ? data.stale
        ? "Dados anteriores"
        : "Open-Meteo · 30 min"
      : "Sem dados";
    status.title = data
      ? "Consultado em " + new Date(data.updatedAt).toLocaleString("pt-BR")
      : "Nova tentativa automática pelo servidor";
    document.querySelector(".weather-icon").hidden = !data || data.weatherCode > 2;
  }
  app.weather = {
    update: function (value) {
      if (config && config.city !== value.city) data = null;
      config = value;
      render();
    },
    setData: function (value) {
      var valid =
        value &&
        [value.temperature, value.minimum, value.maximum, value.weatherCode].every(
          function (number) {
            return typeof number === "number" && isFinite(number);
          },
        ) &&
        typeof value.updatedAt === "string" &&
        isFinite(Date.parse(value.updatedAt)) &&
        (!config || value.city === config.city);
      var next = valid ? value : null;
      if (JSON.stringify(data) !== JSON.stringify(next)) {
        data = next;
        render();
      }
    },
  };
})(window.SmartFrame);
