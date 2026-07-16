/* ==========================================================================
   battery_monitor.js — JK BMS battery monitoring
   Topic: /jkbms_node/battery_state  (sensor_msgs/BatteryState)
   Topic: /jkbms_node/temperature    (sensor_msgs/Temperature)
   Topbar: battery-val, battery-bar, temp-val, battery-time

   Runtime display is updated every 5 minutes using a 5-minute rolling
   average of discharge current — eliminates short-term fluctuations.
   ========================================================================== */

var BATTERY_TOTAL_AH  = 40.0;   /* total pack capacity in Ah */
var _lastCurrentA     = 0;      /* latest discharge current (A, positive = draining) */
var _lastTimestamp    = null;   /* for Δt integration */

/* ── 5-minute rolling average for runtime stability ─────────────────── */
var _SMOOTH_WINDOW_MS = 5 * 60 * 1000;   /* 5 minutes in ms */
var _currentSamples   = [];              /* [{t, current}, ...] */
var _displayedRuntime = null;            /* last value shown to user */
var _lastDisplayTime  = 0;              /* timestamp of last display update */

function _addCurrentSample(currentA) {
  var now = Date.now();
  _currentSamples.push({ t: now, current: currentA });
  /* Drop samples older than the window */
  var cutoff = now - _SMOOTH_WINDOW_MS;
  _currentSamples = _currentSamples.filter(function(s) { return s.t >= cutoff; });
}

function _smoothedCurrent() {
  if (_currentSamples.length === 0) return 0;
  var sum = 0;
  for (var i = 0; i < _currentSamples.length; i++) sum += _currentSamples[i].current;
  return sum / _currentSamples.length;
}

/* ── helpers ─────────────────────────────────────────────────────────── */
function _setEl(id, text, color) {
  var el = document.getElementById(id);
  if (!el) return;
  if (text  !== undefined) el.textContent = text;
  if (color !== undefined) el.style.color = color;
}
function _setBar(id, pct) {
  var el = document.getElementById(id);
  if (!el) return;
  el.style.width = Math.max(0, Math.min(100, pct)) + "%";
  el.style.background = pct < 20 ? "#ef4444" : pct < 50 ? "#f97316" : "#22c55e";
}

/* ── format time helper ─────────────────────────────────────────────── */
function _fmtTime(hours) {
  if (hours < 0.02)  return "< 1m";
  if (hours < 1.0)   return Math.round(hours * 60) + "m";
  if (hours < 10.0)  return hours.toFixed(1) + "h";
  return Math.round(hours) + "h";
}

function _timeColor(hours) {
  if (hours < 0.5)  return "#ef4444";
  if (hours < 1.5)  return "#f97316";
  return "#22c55e";
}

/* ── dock button sync ─────────────────────────────────────────────────── */
/* Called whenever charging state changes. When charging (isCharging=true)
   the robot is docked, so show UNDOCK. When not charging, show DOCK. */
function _updateDockButton(isCharging) {
  var btn = document.getElementById('btn-dock');
  if (!btn) return;
  /* Also sync the _docked flag in app.js if it exists */
  if (typeof _docked !== 'undefined') { _docked = isCharging; }
  if (isCharging) {
    /* Robot is charging — already docked, offer UNDOCK */
    btn.innerHTML = '🔋 UNDOCK';
    btn.style.background  = 'rgba(249,115,22,0.12)';
    btn.style.borderColor = 'rgba(249,115,22,0.4)';
    btn.style.color       = 'var(--accent2, #f97316)';
  } else {
    /* Not charging — offer DOCK */
    btn.innerHTML = '🔌 DOCK';
    btn.style.background  = 'rgba(34,197,94,0.12)';
    btn.style.borderColor = 'rgba(34,197,94,0.4)';
    btn.style.color       = 'var(--green)';
  }
}

/* ── init subscription ──────────────────────────────────────────────── */
function _initBattery() {

  /* BatteryState */
  var battTopic = new ROSLIB.Topic({
    ros:         ros,
    name:        "/jkbms_node/battery_state",
    messageType: "sensor_msgs/BatteryState"
  });


  battTopic.subscribe(function (msg) {
    /* ── SOC ── */
    /* ── SOC (Calibrated Display) ── */
    var raw = parseFloat(msg.percentage) || 0;
    var actualPct = raw <= 1.0 ? Math.round(raw * 100) : Math.round(raw);

    /*
    Calibration:
    100 -> 100
    90  -> 80
    80  -> 70
    70  -> 60
    60  -> 50
    50  -> 40
    40  -> 30
    30  -> 20
    20  -> 10
    10  -> 0
    */

    var pct;

    if (actualPct >= 100) {
      pct = 100;
    } else {
      pct = Math.max(0, actualPct - 10);
    }

    _setEl(
      "battery-val",
      pct + "%",
      pct < 20 ? "#ef4444" : pct < 50 ? "#f97316" : "#22c55e"
    );

    _setBar("battery-bar", pct);

    /* ── Current (positive in JK BMS = charging) ── */
    var cur = parseFloat(msg.current) || 0;
    _lastCurrentA = -cur;   /* positive when discharging */

    /* ── Add to rolling window ── */
    if (_lastCurrentA > 0) {
      _addCurrentSample(_lastCurrentA);
    }

    /* ── Remaining Ah ── */
    var ahRemaining;
    var capField = parseFloat(msg.capacity) || 0;

    if (capField > 0.5) {
      ahRemaining = capField;
    } else {
      /* Use actual battery percentage for runtime calculations */
      ahRemaining = (actualPct / 100) * BATTERY_TOTAL_AH;
    }
    var ahConsumed = BATTERY_TOTAL_AH - ahRemaining;

    /* ── Runtime display removed — keep charge/dock state sync only ── */
    if (_lastCurrentA > 0.2) {
      /* Discharging — robot is not docked */
      _updateDockButton(false);
    } else if (cur > 0.1) {
      /* Charging */
      _displayedRuntime = null;
      _lastDisplayTime  = 0;
      _currentSamples   = [];
      _updateDockButton(true);
    } else {
      /* Idle / not charging */
      _updateDockButton(false);
    }

    /* ── Warnings ── */
    if (typeof showToast === "function" && typeof RobotConfig !== "undefined") {
      if (pct <= RobotConfig.battery.critical_percent) {
        showToast("🔴 Battery CRITICAL: " + pct + "%", "error");
      } else if (pct <= RobotConfig.battery.warn_percent) {
        showToast("⚠ Battery low: " + pct + "%", "error");
      }
    }
  });

  /* Temperature */
  var tempTopic = new ROSLIB.Topic({
    ros:         ros,
    name:        "/jkbms_node/temperature",
    messageType: "sensor_msgs/Temperature"
  });
  tempTopic.subscribe(function (msg) {
    var t = parseFloat(msg.temperature) || 0;
    _setEl("temp-val", t.toFixed(1) + "°C",
           t > 55 ? "#ef4444" : t > 45 ? "#f97316" : "#0ea5e9");
  });
}

/* Subscribe on load and reconnect */
_initBattery();
ros.on("connection", function () { _initBattery(); });