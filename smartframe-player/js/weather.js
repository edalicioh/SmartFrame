(function (app) {
  "use strict";
  var config,
    data = null;
  function temperature(value) {
    return Math.round(value) + "°";
  }
  function render() {
    if (!config || !config.enabled) return;
    document.getElementById("weather-temperature").textContent = data
      ? temperature(data.temperature)
      : "—°";
    document.getElementById("weather-range").textContent = data
      ? "Máx. " + temperature(data.maximum) + "  ·  Mín. " + temperature(data.minimum)
      : "Máx. —° · Mín. —°";
    document
      .getElementById("weather")
      .setAttribute(
        "aria-label",
        data && data.stale ? "Temperaturas — dados anteriores" : "Temperaturas",
      );
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
        [value.temperature, value.minimum, value.maximum].every(function (number) {
          return typeof number === "number" && isFinite(number);
        }) &&
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
