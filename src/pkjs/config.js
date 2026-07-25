module.exports = [
  {
    type: "heading",
    defaultValue: "Watch Settings"
  },
  {
    type: "section",
    items: [
      {
        type: "toggle",
        messageKey: "TEMP_UNIT",
        label: "Use Fahrenheit",
        defaultValue: true
      },
      {
        type: "toggle",
        messageKey: "TIME_FORMAT",
        label: "Use 12-hour time",
        defaultValue: false
      },
      {
        type: "select",
        messageKey: "WEATHER_PROVIDER",
        label: "Weather Provider",
        defaultValue: "0",
        options: [
          { label: "Open-Meteo (free, no key)",    value: "0" },
          { label: "OpenWeatherMap",               value: "1" },
          { label: "WeatherAPI.com",               value: "2" },
          { label: "Weather.gov (US only, no key)",value: "3" }
        ]
      },
      {
        type: "input",
        messageKey: "CUSTOM_LOCATION",
        label: "Location",
        description: "City name (e.g. London) or coordinates (e.g. 51.5,-0.1). Leave blank to use GPS."
      },
      {
        type: "input",
        messageKey: "OWM_API_KEY",
        label: "OpenWeatherMap API Key",
        description: "Get a free key at openweathermap.org"
      },
      {
        type: "input",
        messageKey: "WEATHERAPI_KEY",
        label: "WeatherAPI.com API Key",
        description: "Get a free key at weatherapi.com"
      }
    ]
  },
  {
    type: "submit",
    defaultValue: "Save Settings"
  }
];