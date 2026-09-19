let current = [];

export function rememberShots(shots) {
  current = shots || [];
  return current;
}

export function sessionShots() {
  return current;
}
