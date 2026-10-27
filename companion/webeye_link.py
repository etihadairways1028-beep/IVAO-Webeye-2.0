"""
WebEye Link: sends your exact touchdown to your IVAO WebEye logbook.

Runs next to Microsoft Flight Simulator (2020 / 2024, through SimConnect) or X-Plane
(11 / 12, through its built-in UDP data output, nothing to install in X-Plane).
It watches for the moment the wheels touch down and sends:
  landing rate (fpm), G-force, airspeed, pitch, bank, bounces and fuel used
to the WebEye recorder, which adds it to the flight in your logbook.

Only your VID, the touchdown numbers and your position at touchdown are sent. The recorder
accepts a touchdown only when that VID is flying on IVAO at that position.
"""
import json
import math
import os
import socket
import struct
import sys
import threading
import time
import urllib.request

VERSION = "1.0.0"
RECORDER = os.environ.get("WEBEYE_RECORDER", "https://webeye-recorder.webeyepagesdev.workers.dev")
CONFIG_DIR = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "WebEyeLink")
CONFIG = os.path.join(CONFIG_DIR, "config.json")
HZ = 25  # samples per second


def say(msg):
    print(time.strftime("%H:%M:%S"), " ", msg, flush=True)


def grade(fpm):
    v = abs(fpm)
    return "Butter" if v < 150 else "Smooth" if v < 300 else "Normal" if v < 500 else "Firm" if v < 700 else "Hard"


def load_config():
    try:
        with open(CONFIG) as f:
            return json.load(f)
    except Exception:
        return {}


def save_config(c):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(CONFIG, "w") as f:
        json.dump(c, f)


def ask_vid():
    c = load_config()
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        c["vid"] = int(sys.argv[1])
        save_config(c)
    while not c.get("vid"):
        v = input("Your IVAO VID: ").strip()
        if v.isdigit() and 3 <= len(v) <= 8:
            c["vid"] = int(v)
            save_config(c)
        else:
            print("A VID is a number, like 123456.")
    return c["vid"]


# ───────── Simulators. Each returns a dict sample or None when not connected.


class MSFS:
    name = "MSFS"

    def __init__(self):
        from SimConnect import SimConnect, AircraftRequests  # Windows only

        self.sm = SimConnect()
        self.aq = AircraftRequests(self.sm, _time=0)
        self.name = "MSFS"

    def sample(self):
        g = self.aq.get
        on = g("SIM_ON_GROUND")
        if on is None:
            return None
        return {
            "ground": bool(on),
            "vs": g("VERTICAL_SPEED") or 0.0,  # feet per minute
            "g": g("G_FORCE") or 1.0,
            "ias": g("AIRSPEED_INDICATED") or 0.0,
            "pitch": -math.degrees(g("PLANE_PITCH_DEGREES") or 0.0),  # MSFS: negative is nose up
            "bank": -math.degrees(g("PLANE_BANK_DEGREES") or 0.0),
            "lat": g("PLANE_LATITUDE"),
            "lon": g("PLANE_LONGITUDE"),
            "fuel_kg": (g("FUEL_TOTAL_QUANTITY_WEIGHT") or 0.0) * 0.45359237,
        }

    def close(self):
        try:
            self.sm.exit()
        except Exception:
            pass


class XPlane:
    """X-Plane's UDP 'RREF' interface on port 49000 (on by default in X-Plane 11 and 12)."""

    REFS = [
        ("ground", "sim/flightmodel/failures/onground_any"),
        ("vs", "sim/flightmodel/position/vh_ind_fpm"),
        ("g", "sim/flightmodel/forces/g_nrml"),
        ("ias", "sim/flightmodel/position/indicated_airspeed"),
        ("pitch", "sim/flightmodel/position/theta"),
        ("bank", "sim/flightmodel/position/phi"),
        ("lat", "sim/flightmodel/position/latitude"),
        ("lon", "sim/flightmodel/position/longitude"),
        ("fuel_kg", "sim/flightmodel/weight/m_fuel_total"),
    ]

    def __init__(self, host="127.0.0.1", port=49000):
        self.addr = (host, port)
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("0.0.0.0", 0))
        self.sock.settimeout(1.0)
        self.vals = {}
        self.last = 0.0
        self.name = "X-Plane"
        self.subscribe(HZ)
        # Wait briefly for the first answer, otherwise X-Plane isn't running.
        t0 = time.time()
        while time.time() - t0 < 2.5 and not self.vals:
            self.read()
        if not self.vals:
            self.subscribe(0)
            raise ConnectionError("X-Plane is not answering on UDP port 49000")
        threading.Thread(target=self.loop, daemon=True).start()

    def subscribe(self, freq):
        for i, (_, ref) in enumerate(self.REFS):
            msg = b"RREF\x00" + struct.pack("<ii400s", freq, i, ref.encode())
            self.sock.sendto(msg, self.addr)

    def read(self):
        try:
            data, _ = self.sock.recvfrom(2048)
        except (socket.timeout, OSError):
            return
        if not data.startswith(b"RREF"):
            return
        for off in range(5, len(data) - 7, 8):
            i, v = struct.unpack("<if", data[off : off + 8])
            if 0 <= i < len(self.REFS):
                self.vals[self.REFS[i][0]] = v
        self.last = time.time()

    def loop(self):
        n = 0
        while True:
            self.read()
            n += 1
            if n % (HZ * 10) == 0:
                self.subscribe(HZ)  # re-subscribe now and then in case X-Plane restarted

    def sample(self):
        if time.time() - self.last > 3 or "ground" not in self.vals:
            return None
        s = dict(self.vals)
        s["ground"] = s.get("ground", 0) > 0.5
        return s

    def close(self):
        try:
            self.subscribe(0)
        except Exception:
            pass


def connect():
    errors = []
    for cls in (MSFS, XPlane):
        try:
            return cls()
        except Exception as e:  # not running / not on Windows
            errors.append(f"{cls.__name__}: {e}")
    return None


# ───────── Touchdown detection


def post(path, body):
    req = urllib.request.Request(RECORDER + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "User-Agent": f"WebEyeLink/{VERSION}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


class Watcher:
    def __init__(self, vid, sim):
        self.vid = vid
        self.sim = sim
        self.was_ground = None
        self.hist = []  # recent airborne samples
        self.takeoff_fuel = None
        self.td = None  # touchdown being measured
        self.airborne_since = None

    def step(self, s):
        now = time.time()
        if self.was_ground is None:
            self.was_ground = s["ground"]
            if not s["ground"]:
                self.takeoff_fuel = s.get("fuel_kg")
                say("In the air. Your next landing will be measured.")
            return
        if not s["ground"]:
            self.hist.append((now, s))
            self.hist = [h for h in self.hist if now - h[0] < 2.0]
        # Takeoff
        if self.was_ground and not s["ground"]:
            if self.td and now - self.td["t"] < 12:
                self.td["bounces"] += 1  # bounced back into the air
            else:
                self.airborne_since = now
                if self.td is None:
                    self.takeoff_fuel = s.get("fuel_kg")
                    say(f"Takeoff ({self.sim.name}). Have a good flight.")
        # Touchdown
        if not self.was_ground and s["ground"]:
            if self.td is None:
                # Landing rate: the vertical speed just before the wheels touched.
                before = [h[1] for h in self.hist if now - h[0] < 0.6] or [s]
                fpm = min(b["vs"] for b in before)
                self.td = {"t": now, "fpm": fpm, "g": s.get("g", 1.0), "ias": s.get("ias"), "pitch": s.get("pitch"), "bank": s.get("bank"), "lat": s.get("lat"), "lon": s.get("lon"), "bounces": 0}
                if self.airborne_since and now - self.airborne_since < 60:
                    say("Touch and go / short hop: not sent.")
                    self.td["skip"] = True
        if self.td and now - self.td["t"] < 1.5:
            self.td["g"] = max(self.td["g"], s.get("g", 1.0))  # G peaks just after touchdown
        # Send once the aircraft has settled (catches bounces).
        if self.td and now - self.td["t"] >= 12:
            td, self.td = self.td, None
            if not td.get("skip"):
                self.send(td, s)
            self.takeoff_fuel = None
        self.was_ground = s["ground"]

    def send(self, td, s):
        used = None
        if self.takeoff_fuel is not None and s.get("fuel_kg") is not None:
            used = max(0.0, self.takeoff_fuel - s["fuel_kg"])
        fpm = round(td["fpm"])
        say(f"Touchdown {fpm} fpm · {td['g']:.2f} G · {grade(fpm)}" + (f" · {td['bounces']} bounce(s)" if td["bounces"] else ""))
        body = {"vid": self.vid, "fpm": td["fpm"], "g": td["g"], "ias": td["ias"], "pitch": td["pitch"], "bank": td["bank"], "lat": td["lat"], "lon": td["lon"], "bounces": td["bounces"], "fuelUsedKg": used, "sim": self.sim.name}
        for attempt in range(3):
            code, res = post("/touchdown", body)
            if code == 200:
                say(f"Sent to your WebEye logbook ({res.get('callsign', '')}). It appears a minute or two after IVAO sees you land.")
                return
            if code in (400, 404, 409):
                say(f"Not saved: {res.get('error', code)}")
                return
            time.sleep(5)
        say(f"Couldn't reach WebEye: {res.get('error', code)}")


def main():
    print(f"WebEye Link {VERSION}  ·  exact landing rates for your IVAO WebEye logbook\n")
    vid = ask_vid()
    say(f"VID {vid}. Looking for MSFS or X-Plane… (start the sim; this window can stay open)")
    sim = None
    while True:
        if sim is None:
            sim = connect()
            if sim is None:
                time.sleep(5)
                continue
            say(f"Connected to {sim.name}.")
            watcher = Watcher(vid, sim)
        try:
            s = sim.sample()
        except Exception:
            s = None
        if s is None or s.get("lat") is None:
            if getattr(sim, "_lost", 0) == 0:
                sim._lost = time.time()
            elif time.time() - sim._lost > 10:
                say(f"Lost {sim.name}. Waiting for it to come back…")
                sim.close()
                sim = None
            time.sleep(0.5)
            continue
        sim._lost = 0
        watcher.step(s)
        time.sleep(1 / HZ)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
