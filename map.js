import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

mapboxgl.accessToken = "pk.eyJ1IjoidGpwMDk1IiwiYSI6ImNtcDNueXN5MzB0djMydW9hMHNuaHQyaGgifQ.zzyad9gkLS0-N-rf0aHLjg";

const BLUEBIKES_STATIONS_URL =
  "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";

const BLUEBIKES_TRAFFIC_URL =
  "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";

const BOSTON_BIKE_LANES_URL =
  "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson";

const CAMBRIDGE_BIKE_LANES_URL =
  "https://raw.githubusercontent.com/vis-society/labs/main/7/data/cambridge-bike-lanes.geojson";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const svg = d3.select("#map").select("svg");

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString("en-US", { timeStyle: "short" });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) {
    return trips;
  }

  return trips.filter((trip) => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes = minutesSinceMidnight(trip.ended_at);

    return (
      Math.abs(startedMinutes - timeFilter) <= 60 ||
      Math.abs(endedMinutes - timeFilter) <= 60
    );
  });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stations.map((station) => {
    const id = station.short_name;

    const stationDepartures = departures.get(id) ?? 0;
    const stationArrivals = arrivals.get(id) ?? 0;

    return {
      ...station,
      departures: stationDepartures,
      arrivals: stationArrivals,
      totalTraffic: stationDepartures + stationArrivals,
    };
  });
}

function getFlowColor(station) {
  const total = station.totalTraffic;

  if (total === 0) {
    return "#999";
  }

  const departureRatio = station.departures / total;

  if (departureRatio > 0.55) {
    return "#f28e2b";
  }

  if (departureRatio < 0.45) {
    return "#4e79a7";
  }

  return "#999";
}

map.on("load", async () => {
  const bikeLanePaint = {
    "line-color": "#32D400",
    "line-width": 4,
    "line-opacity": 0.6,
  };

  map.addSource("boston-bike-lanes", {
    type: "geojson",
    data: BOSTON_BIKE_LANES_URL,
  });

  map.addLayer({
    id: "boston-bike-lanes-layer",
    type: "line",
    source: "boston-bike-lanes",
    paint: bikeLanePaint,
  });

  map.addSource("cambridge-bike-lanes", {
    type: "geojson",
    data: CAMBRIDGE_BIKE_LANES_URL,
  });

  map.addLayer({
    id: "cambridge-bike-lanes-layer",
    type: "line",
    source: "cambridge-bike-lanes",
    paint: bikeLanePaint,
  });

  const stationData = await d3.json(BLUEBIKES_STATIONS_URL);

  const trips = await d3.csv(BLUEBIKES_TRAFFIC_URL, (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    return trip;
  });

  const baseStations = stationData.data.stations;
  let stations = computeStationTraffic(baseStations, trips);

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  const circles = svg
    .selectAll("circle")
    .data(stations, (d) => d.short_name)
    .enter()
    .append("circle")
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .attr("fill", getFlowColor)
    .attr("opacity", 0.8)
    .each(function (d) {
      d3.select(this)
        .append("title")
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  function updatePositions() {
    circles
      .attr("cx", (d) => getCoords(d).cx)
      .attr("cy", (d) => getCoords(d).cy);
  }

  function updateScatterPlot(timeFilter) {
    const filteredTrips = filterTripsByTime(trips, timeFilter);
    const filteredStations = computeStationTraffic(baseStations, filteredTrips);

    radiusScale.domain([0, d3.max(filteredStations, (d) => d.totalTraffic)]);

    if (timeFilter === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }

    circles
      .data(filteredStations, (d) => d.short_name)
      .attr("r", (d) => radiusScale(d.totalTraffic))
      .attr("fill", getFlowColor)
      .each(function (d) {
        d3.select(this)
          .select("title")
          .text(
            `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
          );
      });
  }

  const timeSlider = document.getElementById("time-slider");
  const selectedTime = document.getElementById("selected-time");
  const anyTimeLabel = document.getElementById("any-time");

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = "";
      anyTimeLabel.style.display = "block";
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = "none";
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener("input", updateTimeDisplay);

  updatePositions();
  updateTimeDisplay();

  map.on("move", updatePositions);
  map.on("zoom", updatePositions);
  map.on("resize", updatePositions);
  map.on("moveend", updatePositions);
});