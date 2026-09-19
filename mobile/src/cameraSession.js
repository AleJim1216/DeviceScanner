import { nextSetNumber } from "./grouping";

let setNumber = null;

export function cameraSetNumber(shots) {
  if (setNumber == null) {
    setNumber = nextSetNumber(shots);
  }
  return setNumber;
}

export function currentCameraSet() {
  return setNumber;
}

export function clearCameraSession() {
  setNumber = null;
}
