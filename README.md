# DeviceScanner

Mobile capture coach for equipment photos. An Expo app takes or imports photos. A local FastAPI server checks blur and exposure with models fitted on the Capture Coach labels, and uses gated checks for framing and covered DEMO labels.

## Run the model server

From `C:\Users\roblo\projects\DeviceScanner`:

```text
python -m pip install -r requirements.txt
python -m api.train
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000
```

Training reads `C:\Users\roblo\Downloads\Capture_Coach`. Practice labels are training targets only. They are not sent with a photo at evaluation time.

## Run the app

```text
cd mobile
npm install
npx expo start
```

Open the project in Expo Go. On a phone, set the model server to your computer's address, such as `http://192.168.1.20:8000`. `127.0.0.1` only works when the app and the server are on the same machine. An Android emulator should use `http://10.0.2.2:8000`.

The camera screen takes a photo, uploads one, or loads one practice set exactly as listed. The analysis screen shows the missing-view checklist and one card per photo. Swipe sideways to move through the set.

## What is trained

Blur and underexposure are logistic regressions fitted on the 34 labeled photos. Glare, framing, and label obstruction are gates derived from those same labels, not a vision network. Retake sentences come from a catalog grouped out of `practice_labels.csv`. A confident framing result says to step back. Black privacy rectangles are excluded from sharpness and exposure. The model does not try to read through them.

Known misses: some tape-on-label photos (IMG-0027, IMG-0040) stay unmarked, and IMG-0024 stays usable even though the practice label asks for human review. A full practice set can still contain retakes. Missing views are not filled from other photos of the same device.
